import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Project } from './project.entity';
import { GitHubService } from '../github/github.service';

export interface ProjectFilters {
  category?: string;
  language?: string;
  sortBy?: string;
  minStars?: number;
  search?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    private githubService: GitHubService,
  ) {}

  async findAll(filters: ProjectFilters) {
    // If search query is provided OR filters are applied, search GitHub instead of database
    // (GitHub search is more comprehensive than local database)
    const hasSearchQuery = filters.search && filters.search.trim().length > 0;
    const hasFilters = filters.category || filters.language || filters.minStars || filters.sortBy;
    
    if (hasSearchQuery || hasFilters) {
      // Use search query or default to empty string (GitHub will return popular repos)
      const searchQuery = hasSearchQuery ? filters.search! : '';
      return this.searchGitHub({ ...filters, search: searchQuery });
    }

    // Otherwise, query from database (fallback for when no search/filters)
    const queryBuilder = this.projectsRepository.createQueryBuilder('project');

    // Apply filters
    if (filters.category) {
      queryBuilder.andWhere('project.category = :category', {
        category: filters.category,
      });
    }

    if (filters.language) {
      queryBuilder.andWhere('project.language = :language', {
        language: filters.language,
      });
    }

    if (filters.minStars) {
      queryBuilder.andWhere('project.stars >= :minStars', {
        minStars: filters.minStars,
      });
    }

    // Apply sorting
    switch (filters.sortBy) {
      case 'Stars':
        queryBuilder.orderBy('project.stars', 'DESC');
        break;
      case 'Forks':
        queryBuilder.orderBy('project.forks', 'DESC');
        break;
      case 'Recently Updated':
        queryBuilder.orderBy('project.lastUpdated', 'ASC');
        break;
      case 'Most Active':
        queryBuilder.orderBy('project.contributors', 'DESC');
        break;
      default:
        queryBuilder.orderBy('project.rank', 'ASC');
    }

    const projects = await queryBuilder.getMany();

    // Calculate activity level for database projects based on lastUpdated
    const projectsWithActivity = projects.map(project => ({
      ...project,
      status: this.calculateActivityFromLastUpdated(project.lastUpdated),
    }));

    return {
      projects: projectsWithActivity,
      total: projectsWithActivity.length,
    };
  }

  async searchGitHub(filters: ProjectFilters) {
    try {
      const sortBy = filters.sortBy || 'Stars';
      const order = sortBy === 'Stars' || sortBy === 'Forks' ? 'desc' : 'desc';
      
      // First search attempt
      // GitHub API has a maximum of 100 results per page
      let githubResponse = await this.githubService.searchRepositories(
        filters.search || '',
        filters.language !== 'All' ? filters.language : undefined,
        sortBy,
        order,
        100, // GitHub API maximum is 100 per page
        filters.minStars, // Pass minStars to GitHub API
      );

      // Map GitHub repositories to our Project format
      // Note: We skip contributors count to speed up response (can be slow for many repos)
      let projects = githubResponse.items.map((repo, index) => {
          // Calculate rank based on stars (simple ranking)
          const rank = index + 1;

          // Determine category based on language or topics
          let category = 'Other';
          if (repo.language) {
            const lang = repo.language.toLowerCase();
            if (['javascript', 'typescript', 'react', 'vue', 'angular'].some(l => lang.includes(l))) {
              category = 'Frontend';
            } else if (['python', 'java', 'go', 'rust', 'c++', 'c#', 'php', 'ruby'].some(l => lang.includes(l))) {
              category = 'Backend';
            } else if (['swift', 'kotlin', 'dart', 'objective-c'].some(l => lang.includes(l))) {
              category = 'Mobile';
            } else if (['docker', 'kubernetes', 'terraform', 'ansible'].some(l => lang.includes(l))) {
              category = 'DevOps';
            } else if (['python', 'tensorflow', 'pytorch', 'machine-learning', 'ai', 'ml'].some(l => 
              lang.includes(l) || repo.topics?.some(t => t.toLowerCase().includes(l))
            )) {
              category = 'AI/ML';
            } else if (['game', 'unity', 'unreal', 'gamedev'].some(l => 
              repo.topics?.some(t => t.toLowerCase().includes(l))
            )) {
              category = 'GameDev';
            } else if (['os', 'kernel', 'system', 'operating-system'].some(l => 
              repo.topics?.some(t => t.toLowerCase().includes(l))
            )) {
              category = 'Systems';
            }
          }

          // Use topics as tags, or generate from language
          const tags = repo.topics && repo.topics.length > 0 
            ? repo.topics.slice(0, 5)
            : repo.language 
              ? [repo.language]
              : [];

          // Format last updated
          const lastUpdated = this.formatLastUpdated(repo.updated_at);

          // Determine activity level based on last updated date
          // Use the raw updated_at date from GitHub API (ISO 8601 format)
          const activityLevel = this.getActivityLevel(repo.updated_at);

          return {
            id: repo.id,
            name: repo.name,
            description: repo.description || 'No description available',
            rank,
            tags,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            status: activityLevel, // Use activity level instead of 'Active'
            language: repo.language || 'Unknown',
            category,
            lastUpdated,
            contributors: 0, // Contributors count removed for performance (can be slow)
            githubUrl: repo.html_url,
            fullName: repo.full_name,
          } as Project;
        });

      // Apply category filter if specified (minStars already applied in GitHub query)
      let filteredProjects = projects;
      if (filters.category && filters.category !== 'All') {
        filteredProjects = projects.filter(p => p.category === filters.category);
      }

      // Apply additional minStars filter as safety check (though GitHub should have filtered)
      if (filters.minStars && filters.minStars > 0) {
        filteredProjects = filteredProjects.filter(p => p.stars >= filters.minStars!);
      }

      // If we got less than 6 results, try a broader search with "github" appended
      if (filteredProjects.length < 6 && filters.search) {
        try {
          // Extract important words from the query
          const originalQuery = filters.search;
          const keywordResult = this.extractKeywordsFromQuery(originalQuery);
          
          // Build enhanced search query: only important words + "github"
          // Example: "quant research" + "github" = "quant research github"
          let importantWords = '';
          if (keywordResult.keywords.length > 0) {
            importantWords = keywordResult.keywords.join(' ');
          } else if (keywordResult.searchQuery) {
            importantWords = keywordResult.searchQuery;
          } else {
            // Fallback: extract meaningful words from original query
            const words = originalQuery
              .toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter(word => word.length > 3 && !['want', 'work', 'project', 'where', 'used', 'use'].includes(word));
            importantWords = words.join(' ');
          }
          
          // Try multiple search variations to get better results
          // 1. Important words + "github"
          // 2. Important words only (without "github")
          const searchVariations = [];
          
          if (importantWords) {
            searchVariations.push(`${importantWords} github`.trim());
            searchVariations.push(importantWords.trim()); // Try without github too
          }
          
          // Try each variation and use the one with most results
          let bestResponse = null;
          let bestCount = filteredProjects.length;
          
          for (const searchQuery of searchVariations) {
            try {
              const enhancedResponse = await this.githubService.searchRepositories(
                searchQuery,
                filters.language !== 'All' ? filters.language : undefined,
                sortBy,
                order,
                100, // GitHub API maximum is 100 per page
                filters.minStars,
              );
              
              if (enhancedResponse.items.length > bestCount) {
                bestResponse = enhancedResponse;
                bestCount = enhancedResponse.items.length;
              }
            } catch (error) {
              // Continue with next variation
            }
          }
          
          // Use the best response if we found one
          if (bestResponse && bestResponse.items.length > filteredProjects.length) {
            const enhancedResponse = bestResponse;

            // Map enhanced results
            const enhancedProjects = enhancedResponse.items.map((repo, index) => {
              const rank = index + 1;

              let category = 'Other';
              if (repo.language) {
                const lang = repo.language.toLowerCase();
                if (['javascript', 'typescript', 'react', 'vue', 'angular'].some(l => lang.includes(l))) {
                  category = 'Frontend';
                } else if (['python', 'java', 'go', 'rust', 'c++', 'c#', 'php', 'ruby'].some(l => lang.includes(l))) {
                  category = 'Backend';
                } else if (['swift', 'kotlin', 'dart', 'objective-c'].some(l => lang.includes(l))) {
                  category = 'Mobile';
                } else if (['docker', 'kubernetes', 'terraform', 'ansible'].some(l => lang.includes(l))) {
                  category = 'DevOps';
                } else if (['python', 'tensorflow', 'pytorch', 'machine-learning', 'ai', 'ml'].some(l => 
                  lang.includes(l) || repo.topics?.some(t => t.toLowerCase().includes(l))
                )) {
                  category = 'AI/ML';
                } else if (['game', 'unity', 'unreal', 'gamedev'].some(l => 
                  repo.topics?.some(t => t.toLowerCase().includes(l))
                )) {
                  category = 'GameDev';
                } else if (['os', 'kernel', 'system', 'operating-system'].some(l => 
                  repo.topics?.some(t => t.toLowerCase().includes(l))
                )) {
                  category = 'Systems';
                }
              }

              const tags = repo.topics && repo.topics.length > 0 
                ? repo.topics.slice(0, 5)
                : repo.language 
                  ? [repo.language]
                  : [];

              const lastUpdated = this.formatLastUpdated(repo.updated_at);
              const activityLevel = this.getActivityLevel(repo.updated_at);

              return {
                id: repo.id,
                name: repo.name,
                description: repo.description || 'No description available',
                rank,
                tags,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                status: activityLevel,
                language: repo.language || 'Unknown',
                category,
                lastUpdated,
                contributors: 0,
                githubUrl: repo.html_url,
                fullName: repo.full_name,
              } as Project;
            });

            // Apply filters to enhanced results
            let enhancedFiltered = enhancedProjects;
            if (filters.category && filters.category !== 'All') {
              enhancedFiltered = enhancedProjects.filter(p => p.category === filters.category);
            }
            if (filters.minStars && filters.minStars > 0) {
              enhancedFiltered = enhancedFiltered.filter(p => p.stars >= filters.minStars!);
            }

            // Use enhanced results if we got more
            if (enhancedFiltered.length > filteredProjects.length) {
              filteredProjects = enhancedFiltered;
            }
          }
        } catch (error) {
          console.error('Enhanced search failed, using original results:', error);
          // Continue with original results if enhanced search fails
        }
      }

      // Limit to 30 results for display (but we fetched more to get diverse activity levels)
      const limitedProjects = filteredProjects.slice(0, 30);

      return {
        projects: limitedProjects,
        total: limitedProjects.length,
      };
    } catch (error) {
      console.error('GitHub search error:', error);
      // Return empty results on error
      return {
        projects: [],
        total: 0,
      };
    }
  }

  private formatLastUpdated(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  private getActivityLevel(dateString: string): 'Most Active' | 'Medium' | 'Rare' {
    try {
      const date = new Date(dateString);
      
      // Validate date
      if (isNaN(date.getTime())) {
        console.warn(`Invalid date string: ${dateString}, defaulting to Rare`);
        return 'Rare';
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Handle negative days (future dates) - shouldn't happen but just in case
      if (diffDays < 0) {
        return 'Most Active';
      }


      // Most Active: Updated within last 7 days (0-7 days)
      if (diffDays <= 7) {
        return 'Most Active';
      }
      // Medium: Updated within last 30 days (8-30 days)
      if (diffDays <= 30) {
        return 'Medium';
      }
      // Rare: Updated more than 30 days ago (31+ days)
      return 'Rare';
    } catch (error) {
      console.error(`Error calculating activity level for date: ${dateString}`, error);
      return 'Rare';
    }
  }

  private calculateActivityFromLastUpdated(lastUpdated: string): 'Most Active' | 'Medium' | 'Rare' {
    // Parse the lastUpdated string (format: "Today", "1 day ago", "2 days ago", etc.)
    const now = new Date();
    let diffDays = 0;

    if (lastUpdated === 'Today') {
      diffDays = 0;
    } else if (lastUpdated === '1 day ago') {
      diffDays = 1;
    } else if (lastUpdated.includes('days ago')) {
      diffDays = parseInt(lastUpdated) || 0;
    } else if (lastUpdated.includes('weeks ago')) {
      const weeks = parseInt(lastUpdated) || 0;
      diffDays = weeks * 7;
    } else if (lastUpdated.includes('months ago')) {
      const months = parseInt(lastUpdated) || 0;
      diffDays = months * 30;
    } else if (lastUpdated.includes('years ago')) {
      const years = parseInt(lastUpdated) || 0;
      diffDays = years * 365;
    } else {
      // Try to parse as ISO date string
      const date = new Date(lastUpdated);
      if (!isNaN(date.getTime())) {
        const diffMs = now.getTime() - date.getTime();
        diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      } else {
        // Default to Rare if we can't parse
        return 'Rare';
      }
    }

    // Most Active: Updated within last 7 days
    if (diffDays <= 7) {
      return 'Most Active';
    }
    // Medium: Updated within last 30 days
    if (diffDays <= 30) {
      return 'Medium';
    }
    // Rare: Updated more than 30 days ago
    return 'Rare';
  }

  async getCategories(): Promise<string[]> {
    const result = await this.projectsRepository
      .createQueryBuilder('project')
      .select('DISTINCT project.category', 'category')
      .getRawMany();
    
    return result.map((r) => r.category).filter(Boolean);
  }

  async getLanguages(): Promise<string[]> {
    const result = await this.projectsRepository
      .createQueryBuilder('project')
      .select('DISTINCT project.language', 'language')
      .getRawMany();
    
    return result.map((r) => r.language).filter(Boolean);
  }

  async getNewlyAdded(page: number = 1, limit: number = 10) {
    try {
      // Search GitHub for recently created repositories
      // GitHub API doesn't support 'created' sort, so we use 'updated' and sort by created_at in code
      const githubResponse = await this.githubService.searchRepositories(
        'is:public',
        undefined,
        'updated', // GitHub API sort (will re-sort by created_at below)
        'desc',
        100, // GitHub API maximum is 100 per page
        undefined,
      );

      // Map GitHub repositories to our Project format
      const projects = githubResponse.items.map((repo, index) => {
        const rank = index + 1;

        // Determine category based on language or topics
        let category = 'Other';
        if (repo.language) {
          const lang = repo.language.toLowerCase();
          if (['javascript', 'typescript', 'react', 'vue', 'angular'].some(l => lang.includes(l))) {
            category = 'Frontend';
          } else if (['python', 'java', 'go', 'rust', 'c++', 'c#', 'php', 'ruby'].some(l => lang.includes(l))) {
            category = 'Backend';
          } else if (['swift', 'kotlin', 'dart', 'objective-c'].some(l => lang.includes(l))) {
            category = 'Mobile';
          } else if (['docker', 'kubernetes', 'terraform', 'ansible'].some(l => lang.includes(l))) {
            category = 'DevOps';
          } else if (['python', 'tensorflow', 'pytorch', 'machine-learning', 'ai', 'ml'].some(l => 
            lang.includes(l) || repo.topics?.some(t => t.toLowerCase().includes(l))
          )) {
            category = 'AI/ML';
          } else if (['game', 'unity', 'unreal', 'gamedev'].some(l => 
            repo.topics?.some(t => t.toLowerCase().includes(l))
          )) {
            category = 'GameDev';
          } else if (['os', 'kernel', 'system', 'operating-system'].some(l => 
            repo.topics?.some(t => t.toLowerCase().includes(l))
          )) {
            category = 'Systems';
          }
        }

        const tags = repo.topics && repo.topics.length > 0 
          ? repo.topics.slice(0, 5)
          : repo.language 
            ? [repo.language]
            : [];

        const lastUpdated = this.formatLastUpdated(repo.updated_at);
        const activityLevel = this.getActivityLevel(repo.updated_at);

        return {
          id: repo.id,
          name: repo.name,
          description: repo.description || 'No description available',
          rank,
          tags,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          status: activityLevel,
          language: repo.language || 'Unknown',
          category,
          lastUpdated,
          contributors: 0,
          githubUrl: repo.html_url,
          fullName: repo.full_name,
          createdAt: (repo as any).created_at || repo.updated_at, // Use created_at if available, fallback to updated_at
        } as Project & { createdAt: string };
      });

      // Sort by creation date (newest first)
      projects.sort((a, b) => {
        const dateA = new Date((a as any).createdAt).getTime();
        const dateB = new Date((b as any).createdAt).getTime();
        return dateB - dateA; // Newest first
      });

      // Calculate pagination
      const total = projects.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedProjects = projects.slice(startIndex, endIndex);

      return {
        projects: paginatedProjects,
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      console.error('Error fetching newly added projects:', error);
      return {
        projects: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
      };
    }
  }

  async getRepositoryDetails(owner: string, repo: string) {
    try {
      // Fetch all details in parallel
      const [repoDetails, contributors, languages] = await Promise.all([
        this.githubService.getFullRepositoryDetails(owner, repo),
        this.githubService.getContributors(owner, repo, 20), // Get top 20 contributors
        this.githubService.getLanguages(owner, repo),
      ]);

      // Calculate language percentages
      const totalBytes = Object.values(languages).reduce((sum: number, bytes: any) => sum + bytes, 0);
      const languagesWithPercentages = Object.entries(languages).map(([lang, bytes]) => ({
        name: lang,
        bytes: bytes as number,
        percentage: totalBytes > 0 ? ((bytes as number / totalBytes) * 100).toFixed(1) : '0',
      })).sort((a, b) => b.bytes - a.bytes);

      return {
        repository: {
          id: repoDetails.id,
          name: repoDetails.name,
          fullName: repoDetails.full_name,
          description: repoDetails.description,
          url: repoDetails.html_url,
          homepage: repoDetails.homepage,
          stars: repoDetails.stargazers_count,
          forks: repoDetails.forks_count,
          watchers: repoDetails.watchers_count,
          openIssues: repoDetails.open_issues_count,
          defaultBranch: repoDetails.default_branch,
          createdAt: repoDetails.created_at,
          updatedAt: repoDetails.updated_at,
          pushedAt: repoDetails.pushed_at,
          license: repoDetails.license?.name || 'No License',
          topics: repoDetails.topics || [],
          archived: repoDetails.archived,
          disabled: repoDetails.disabled,
        },
        owner: {
          login: repoDetails.owner.login,
          avatar: repoDetails.owner.avatar_url,
          url: repoDetails.owner.html_url,
          type: repoDetails.owner.type,
        },
        maintainers: repoDetails.owner.type === 'Organization' ? [] : [{
          login: repoDetails.owner.login,
          avatar: repoDetails.owner.avatar_url,
          url: repoDetails.owner.html_url,
        }],
        contributors: contributors.map((contrib: any) => ({
          login: contrib.login,
          avatar: contrib.avatar_url,
          url: contrib.html_url,
          contributions: contrib.contributions,
        })),
        languages: languagesWithPercentages,
      };
    } catch (error) {
      console.error('Error fetching repository details:', error);
      throw error;
    }
  }

  extractKeywordsFromQuery(query: string): { keywords: string[]; searchQuery: string } {
    if (!query || query.trim().length === 0) {
      return { keywords: [], searchQuery: '' };
    }

    // Common stop words to filter out
    const stopWords = new Set([
      'i', 'want', 'to', 'work', 'in', 'repo', 'repository', 'repositories', 'where', 'are', 'used', 'use',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'was',
      'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may',
      'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'why',
      'how', 'all', 'each', 'every', 'some', 'any', 'no', 'not', 'only', 'just', 'also', 'more', 'most',
      'very', 'too', 'so', 'such', 'as', 'like', 'about', 'into', 'onto', 'upon', 'within', 'without',
      'project', 'projects', 'code', 'coding', 'develop', 'development', 'developer', 'developing'
    ]);

    // Extract keywords: tech terms, frameworks, libraries, tools, and domain-specific terms
    const techKeywords = [
      // Frameworks & Libraries
      'nestjs', 'express', 'react', 'vue', 'angular', 'nextjs', 'nuxt', 'svelte', 'remix',
      'django', 'flask', 'fastapi', 'spring', 'laravel', 'rails', 'phoenix', 'gin', 'echo',
      // Databases
      'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'cassandra', 'elasticsearch',
      'sqlite', 'dynamodb', 'neo4j', 'influxdb',
      // Message Queues & Streaming
      'kafka', 'rabbitmq', 'redis', 'nats', 'pulsar', 'activemq',
      // Cloud & DevOps
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins',
      'github', 'gitlab', 'ci', 'cd', 'devops',
      // Languages
      'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'cpp', 'csharp', 'php',
      'ruby', 'swift', 'kotlin', 'dart', 'scala', 'clojure', 'elixir', 'haskell',
      // Tools & Others
      'graphql', 'rest', 'api', 'microservices', 'serverless', 'lambda', 'grpc', 'websocket',
      'oauth', 'jwt', 'oauth2', 'authentication', 'authorization', 'security', 'encryption',
      'machine learning', 'ml', 'ai', 'deep learning', 'neural network', 'tensorflow', 'pytorch',
      'blockchain', 'web3', 'ethereum', 'solidity', 'smart contract',
      'testing', 'jest', 'mocha', 'pytest', 'junit', 'cypress', 'selenium',
      // Domain-specific terms
      'quant', 'quantitative', 'research', 'finance', 'trading', 'algorithmic', 'backtesting',
      'data science', 'analytics', 'visualization', 'statistics', 'mathematics', 'math',
      'cryptocurrency', 'crypto', 'bitcoin', 'defi', 'nft', 'game', 'gaming', 'engine',
      'iot', 'embedded', 'robotics', 'automation', 'scraping', 'crawler', 'parser',
      // Data Science & Research Tools
      'jupyter', 'jupyter notebook', 'notebook', 'ipython', 'colab', 'google colab',
      'pandas', 'numpy', 'scipy', 'matplotlib', 'seaborn', 'plotly', 'bokeh',
      'scikit-learn', 'sklearn', 'xgboost', 'lightgbm', 'catboost',
      'r', 'rstudio', 'shiny', 'rmarkdown',
      'spark', 'hadoop', 'hive', 'kafka', 'flink', 'storm',
      'tableau', 'powerbi', 'qlik', 'looker', 'metabase'
    ];

    // Convert query to lowercase for processing
    const lowerQuery = query.toLowerCase();
    
    // Extract tech keywords that appear in the query
    const foundKeywords: string[] = [];
    for (const keyword of techKeywords) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    }

    // Extract other potential keywords (words that are not stop words and are meaningful)
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Add unique meaningful words that aren't already in tech keywords
    const additionalKeywords = words.filter(
      word => !foundKeywords.some(kw => kw.toLowerCase().includes(word) || word.includes(kw.toLowerCase()))
    );

    // Combine tech keywords and additional keywords, remove duplicates
    const allKeywords = [...new Set([...foundKeywords, ...additionalKeywords])];

    // Build search query: use BOTH extracted keywords AND meaningful words from original query
    // This ensures we don't lose any relevant terms
    // For GitHub search, we want to be as inclusive as possible
    let searchQuery = '';
    
    // Always include meaningful words from the original query (length > 2)
    const meaningfulWords = words.filter(w => w.length > 2);
    
    if (allKeywords.length > 0) {
      // Combine extracted keywords with meaningful words
      // This ensures we capture both tech terms and domain-specific terms
      const combinedTerms = [...new Set([...allKeywords, ...meaningfulWords])];
      searchQuery = combinedTerms.join(' ');
    } else {
      // If no tech keywords found, use all meaningful words from original query
      // This is important for domain-specific searches like "quant research"
      searchQuery = meaningfulWords.length > 0 
        ? meaningfulWords.join(' ') 
        : query.trim(); // Last resort: use original query
    }

    // Ensure search query is not empty
    if (!searchQuery.trim()) {
      searchQuery = query.trim();
    }

    return {
      keywords: allKeywords,
      searchQuery: searchQuery.trim(),
    };
  }
}

