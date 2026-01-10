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

  constructor(private configService: ConfigService) {
    // Optional: Use GitHub token for higher rate limits
    this.token = this.configService.get<string>('GITHUB_TOKEN') || null;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OpenRank',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    return headers;
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
      
      // Build search query - GitHub searches in name, description, topics, and README by default
      // We don't need to add "is:public" explicitly as we're searching public repos
      // But we can add it for clarity and to ensure we only get public repos
      let searchQuery = cleanQuery.length > 0 ? `${cleanQuery} is:public` : 'is:public';
      
      // For better results, we can also search in topics explicitly
      // But GitHub already searches in topics by default, so we'll keep it simple
      
      if (language && language !== 'All') {
        searchQuery += ` language:${language}`;
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
      
      console.log('GitHub API Request URL:', url);
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub API Error Response:', errorText);
        if (response.status === 403) {
          throw new HttpException('GitHub API rate limit exceeded. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
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

