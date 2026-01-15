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
    if (!this.token) {
      console.warn('⚠️  GITHUB_TOKEN not configured. API rate limit: 60 requests/hour (unauthenticated). Add GITHUB_TOKEN for 5000 requests/hour.');
    } else {
      console.log('✓ GitHub token configured. Rate limit: 5000 requests/hour.');
    }
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

  async getUser(username: string): Promise<any> {
    try {
      const url = `${this.githubApiUrl}/users/${username}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new HttpException(`User ${username} not found`, HttpStatus.NOT_FOUND);
        }
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to fetch user: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getUserOrganizations(username: string): Promise<any[]> {
    try {
      const url = `${this.githubApiUrl}/users/${username}/orgs`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      return [];
    }
  }

  async getOrganizationMembers(org: string, perPage: number = 100, page: number = 1): Promise<any[]> {
    try {
      const url = `${this.githubApiUrl}/orgs/${org}/members?per_page=${perPage}&page=${page}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new HttpException(`GitHub API error: ${response.statusText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      return [];
    }
  }

  async searchUsersByCompany(company: string, perPage: number = 30): Promise<any> {
    try {
      const url = `${this.githubApiUrl}/search/users?q=${encodeURIComponent(`company:"${company}"`)}&per_page=${perPage}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('=== GitHub API Error (searchUsersByCompany) ===');
        console.error('Status:', response.status);
        console.error('Company:', company);
        
        let errorMessage = response.statusText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch (e) {
          // If JSON parsing fails, use status text
        }
        
        if (response.status === 403) {
          const rateLimitMessage = this.token 
            ? 'GitHub API rate limit exceeded. Please try again later.'
            : 'GitHub API rate limit exceeded (60 requests/hour without token). Please add GITHUB_TOKEN for higher limits (5000 requests/hour).';
          throw new HttpException(rateLimitMessage, HttpStatus.TOO_MANY_REQUESTS);
        }
        
        throw new HttpException(`GitHub API error: ${errorMessage}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to search users by company: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getUserRepositories(username: string, perPage: number = 100, page: number = 1): Promise<any[]> {
    try {
      const url = `${this.githubApiUrl}/users/${username}/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`;

      await this.throttleRequest();

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

  async getUserEvents(username: string, perPage: number = 100): Promise<any[]> {
    try {
      const url = `${this.githubApiUrl}/users/${username}/events/public?per_page=${perPage}`;

      await this.throttleRequest();

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

  async getRepositoryContributions(owner: string, repo: string, username: string): Promise<any> {
    try {
      // Get contributor stats
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/stats/contributors`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      const contributors = await response.json();
      if (!Array.isArray(contributors)) {
        return null;
      }

      // Find the specific user's contributions
      const userContributions = contributors.find((contrib: any) => {
        return contrib.author && contrib.author.login === username;
      });

      return userContributions || null;
    } catch (error) {
      return null;
    }
  }

  async searchUsers(query: string, perPage: number = 30): Promise<any> {
    try {
      const url = `${this.githubApiUrl}/search/users?q=${encodeURIComponent(query)}&per_page=${perPage}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('=== GitHub API Error (searchUsers) ===');
        console.error('Status:', response.status);
        console.error('Status Text:', response.statusText);
        console.error('Query:', query);
        
        let errorMessage = response.statusText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch (e) {
          // If JSON parsing fails, use status text
        }
        
        if (response.status === 403) {
          const rateLimitMessage = this.token 
            ? 'GitHub API rate limit exceeded. Please try again later.'
            : 'GitHub API rate limit exceeded (60 requests/hour without token). Please add GITHUB_TOKEN for higher limits (5000 requests/hour).';
          throw new HttpException(rateLimitMessage, HttpStatus.TOO_MANY_REQUESTS);
        }
        
        throw new HttpException(`GitHub API error: ${errorMessage}`, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(`Failed to search users: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async searchPullRequests(query: string, perPage: number = 100): Promise<any> {
    try {
      const url = `${this.githubApiUrl}/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}`;

      await this.throttleRequest();

      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { total_count: 0, items: [] };
      }

      return await response.json();
    } catch (error) {
      return { total_count: 0, items: [] };
    }
  }

  async getUserPullRequests(username: string, state: string = 'merged', perPage: number = 100): Promise<any[]> {
    try {
      // Search for merged PRs by user in last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const dateStr = ninetyDaysAgo.toISOString().split('T')[0];
      
      const query = `author:${username} type:pr is:${state} merged:>=${dateStr}`;
      const result = await this.searchPullRequests(query, perPage);
      
      return result.items || [];
    } catch (error) {
      return [];
    }
  }

  async getUserIssuesClosed(username: string, perPage: number = 100): Promise<any[]> {
    try {
      // Search for closed issues (not created by user) in last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const dateStr = ninetyDaysAgo.toISOString().split('T')[0];
      
      const query = `-author:${username} type:issue is:closed commenter:${username} closed:>=${dateStr}`;
      const result = await this.searchPullRequests(query, perPage);
      
      return result.items || [];
    } catch (error) {
      return [];
    }
  }

  async getUserPRReviews(username: string, perPage: number = 100): Promise<any[]> {
    try {
      // Search for PR reviews in last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const dateStr = ninetyDaysAgo.toISOString().split('T')[0];
      
      const query = `reviewed-by:${username} type:pr reviewed:>=${dateStr}`;
      const result = await this.searchPullRequests(query, perPage);
      
      return result.items || [];
    } catch (error) {
      return [];
    }
  }

  async isMaintainerOfActiveRepo(username: string): Promise<boolean> {
    try {
      // Get user's repos and check if any are active (updated in last 90 days)
      const repos = await this.getUserRepositories(username, 10, 1);
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      for (const repo of repos) {
        if (!repo.fork && repo.owner.login === username) {
          const updatedAt = new Date(repo.updated_at);
          if (updatedAt >= ninetyDaysAgo && (repo.stargazers_count > 0 || repo.forks_count > 0)) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
}

