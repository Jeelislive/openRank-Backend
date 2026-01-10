import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  created_at: string;
  updated_at: string;
  open_issues_count: number;
  topics: string[];
  owner: {
    login: string;
  };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepo[];
}

@Injectable()
export class GitHubService {
  private readonly githubApiUrl = 'https://api.github.com';
  private readonly token: string | null;
  private lastRequestTime = 0;
  private readonly minRequestInterval = 150; // 150ms between requests

  constructor(private configService: ConfigService) {
    this.token = this.configService.get<string>('GITHUB_TOKEN') || null;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OpenRank/1.0 (https://open-rank.vercel.app)',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    return headers;
  }

  private async throttleRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  async searchRepositories(query: string, language?: string, sort: string = 'stars', order: string = 'desc', perPage: number = 30, minStars?: number): Promise<GitHubSearchResponse> {
    try {
      // Build search query - only open source repositories
      // GitHub search works best when we search in name, description, topics, and README
      // If query is empty, search for all public repos (will be filtered by other params)
      
      // GitHub API has a maximum of 100 results per page
      const maxPerPage = Math.min(perPage, 100);
      
      // Clean the query - remove extra spaces and ensure proper formatting
      const cleanQuery = (query || '').trim().replace(/\s+/g, ' ');
      
      // Build search query - GitHub requires at least some search term
      // Check if query already contains 'is:public' to avoid duplication
      const alreadyHasIsPublic = cleanQuery.toLowerCase().includes('is:public');
      
      // If query is empty, use a wildcard search to get all public repos
      let searchQuery = cleanQuery.length > 0 
        ? (alreadyHasIsPublic ? cleanQuery : `${cleanQuery} is:public`)
        : '* is:public'; // Use * to match all when no search term
      
      // For better results, we can also search in topics explicitly
      // But GitHub already searches in topics by default, so we'll keep it simple
      
      if (language && language !== 'All') {
        // Escape language name if it contains special characters
        const safeLanguage = language.replace(/[^\w\s-]/g, '');
        searchQuery += ` language:${safeLanguage}`;
      }

      // Add stars filter to GitHub query if specified
      if (minStars && minStars > 0) {
        searchQuery += ` stars:>=${minStars}`;
      }

      // GitHub API only supports: stars, forks, updated, help-wanted-issues
      // Convert our sort values to GitHub API format
      let githubSort = 'stars'; // default
      if (sort === 'Stars' || sort === 'stars' || sort === 'Rank') {
        githubSort = 'stars';
      } else if (sort === 'Forks' || sort === 'forks') {
        githubSort = 'forks';
      } else if (sort === 'updated' || sort === 'Recently Updated') {
        githubSort = 'updated';
      }

      const params = new URLSearchParams({
        q: searchQuery,
        sort: githubSort,
        order: order.toLowerCase(),
        per_page: maxPerPage.toString(),
      });

      const url = `${this.githubApiUrl}/search/repositories?${params.toString()}`;

      // Throttle request
      await this.throttleRequest();

      console.log('=== GitHub API Request ===');
      console.log('URL:', url);
      console.log('Query:', searchQuery);
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('=== GitHub API Error ===');
        console.error('Status:', response.status);
        console.error('Status Text:', response.statusText);
        console.error('Error Response:', errorText);
        console.error('Request URL:', url);
        
        // Parse error response to check for spammy flag
        let errorMessage = response.statusText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.message && errorData.message.includes('spammy')) {
            errorMessage = 'GitHub API temporarily flagged requests as spam. This usually resets within a few hours. Free limit: 60 requests/hour without token.';
            console.warn('GitHub API spammy flag detected - this is temporary and will reset');
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch (e) {
          // If JSON parsing fails, use status text
        }
        
        if (response.status === 403) {
          throw new HttpException('GitHub API rate limit exceeded (60 requests/hour without token). Please try again later or add GITHUB_TOKEN for higher limits.', HttpStatus.TOO_MANY_REQUESTS);
        }
        throw new HttpException(`GitHub API error: ${errorMessage}`, response.status);
      }

      const data: GitHubSearchResponse = await response.json();
      return data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to search GitHub: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getRepositoryDetails(owner: string, repo: string): Promise<GitHubRepo> {
    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to fetch repository: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getContributorsCount(owner: string, repo: string): Promise<number> {
    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`;
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return 0; // Return 0 if we can't get contributors
      }

      // Get the Link header to find total count
      const linkHeader = response.headers.get('link');
      if (linkHeader) {
        const match = linkHeader.match(/page=(\d+)>; rel="last"/);
        if (match) {
          return parseInt(match[1]) * 30; // Approximate count
        }
      }

      // Fallback: count contributors from first page
      const contributors = await response.json();
      return Array.isArray(contributors) ? contributors.length : 0;
    } catch (error) {
      return 0;
    }
  }

  async getContributors(owner: string, repo: string, perPage: number = 10): Promise<any[]> {
    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/contributors?per_page=${perPage}`;
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error) {
      return [];
    }
  }

  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/languages`;
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return {};
      }

      return await response.json();
    } catch (error) {
      return {};
    }
  }

  async getFullRepositoryDetails(owner: string, repo: string): Promise<any> {
    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to fetch repository: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

