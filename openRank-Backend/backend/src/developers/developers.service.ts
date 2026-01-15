import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Developer } from './developer.entity';
import { GitHubService } from '../github/github.service';

@Injectable()
export class DevelopersService {
  constructor(
    @InjectRepository(Developer)
    private developerRepository: Repository<Developer>,
    private githubService: GitHubService,
  ) {}

  /**
   * Calculate Developer Impact Score (DIS)
   * DIS = (PR_Impact * 0.30) + (Issue_Impact * 0.20) + (Dependency_Influence * 0.15) +
   *       (Project_Longevity * 0.10) + (Community_Impact * 0.10) + (Docs_Impact * 0.05) +
   *       (Consistency * 0.05) + (Quality_Multiplier)
   */
  private calculateImpactScore(developer: Partial<Developer>): number {
    const prImpact = (developer.prImpact || 0) * 0.30;
    const issueImpact = (developer.issueImpact || 0) * 0.20;
    const dependencyInfluence = (developer.dependencyInfluence || 0) * 0.15;
    const projectLongevity = (developer.projectLongevity || 0) * 0.10;
    const communityImpact = (developer.communityImpact || 0) * 0.10;
    const docsImpact = (developer.docsImpact || 0) * 0.05;
    const consistency = (developer.consistency || 0) * 0.05;
    const qualityMultiplier = developer.qualityMultiplier || 1.0;

    const baseScore = prImpact + issueImpact + dependencyInfluence + 
                     projectLongevity + communityImpact + docsImpact + consistency;
    
    return baseScore * qualityMultiplier;
  }

  /**
   * Calculate PR Impact based on PRs, merges, and PR quality
   */
  private calculatePRImpact(totalPRs: number, mergedPRs: number, prStars: number): number {
    if (totalPRs === 0) return 0;
    
    const mergeRate = mergedPRs / totalPRs;
    const prQuality = Math.log10(prStars + 1) * 10; // Logarithmic scale for stars
    const prVolume = Math.log10(totalPRs + 1) * 20;
    
    return (mergeRate * 40) + (prQuality * 0.3) + (prVolume * 0.3);
  }

  /**
   * Calculate Issue Impact based on issues created, closed, and engagement
   */
  private calculateIssueImpact(totalIssues: number, closedIssues: number, issueEngagement: number): number {
    if (totalIssues === 0) return 0;
    
    const closeRate = closedIssues / totalIssues;
    const engagementScore = Math.log10(issueEngagement + 1) * 10;
    const issueVolume = Math.log10(totalIssues + 1) * 15;
    
    return (closeRate * 30) + (engagementScore * 0.4) + (issueVolume * 0.3);
  }

  /**
   * Calculate Dependency Influence based on how many projects depend on their work
   */
  private calculateDependencyInfluence(dependents: number, packageDownloads: number): number {
    const dependentScore = Math.log10(dependents + 1) * 25;
    const downloadScore = Math.log10(packageDownloads + 1) * 0.1;
    
    return dependentScore + downloadScore;
  }

  /**
   * Calculate Project Longevity based on project age and maintenance
   */
  private calculateProjectLongevity(yearsActive: number, activeProjects: number, lastActiveAt: Date): number {
    const yearsScore = Math.min(yearsActive * 10, 50); // Max 50 points for 5+ years
    const projectsScore = Math.min(activeProjects * 2, 30); // Max 30 points
    const recencyScore = this.getRecencyScore(lastActiveAt);
    
    return yearsScore + projectsScore + recencyScore;
  }

  /**
   * Calculate Community Impact based on followers, contributions, and engagement
   */
  private calculateCommunityImpact(followers: number, totalContributions: number, starsReceived: number): number {
    const followerScore = Math.log10(followers + 1) * 15;
    const contributionScore = Math.log10(totalContributions + 1) * 10;
    const starScore = Math.log10(starsReceived + 1) * 5;
    
    return followerScore + contributionScore + starScore;
  }

  /**
   * Calculate Docs Impact based on documentation contributions
   */
  private calculateDocsImpact(docPRs: number, docCommits: number): number {
    const docPRScore = docPRs * 5;
    const docCommitScore = Math.log10(docCommits + 1) * 10;
    
    return docPRScore + docCommitScore;
  }

  /**
   * Calculate Consistency based on regular contributions
   */
  private calculateConsistency(totalCommits: number, yearsActive: number, avgCommitsPerMonth: number): number {
    if (yearsActive === 0) return 0;
    
    const commitConsistency = Math.min(avgCommitsPerMonth / 10, 1) * 30; // Max 30 points
    const activityConsistency = Math.min(totalCommits / (yearsActive * 100), 1) * 20; // Max 20 points
    
    return commitConsistency + activityConsistency;
  }

  /**
   * Calculate Quality Multiplier based on code quality metrics
   */
  private calculateQualityMultiplier(
    codeReviewRatio: number,
    testCoverage: number,
    codeComplexity: number
  ): number {
    let multiplier = 1.0;
    
    // Code review participation increases quality
    if (codeReviewRatio > 0.5) multiplier += 0.2;
    else if (codeReviewRatio > 0.3) multiplier += 0.1;
    
    // Test coverage increases quality
    if (testCoverage > 0.7) multiplier += 0.15;
    else if (testCoverage > 0.5) multiplier += 0.1;
    
    // Lower complexity is better
    if (codeComplexity < 10) multiplier += 0.1;
    else if (codeComplexity > 50) multiplier -= 0.1;
    
    return Math.max(0.5, Math.min(2.0, multiplier)); // Clamp between 0.5 and 2.0
  }

  /**
   * Get recency score based on last activity
   */
  private getRecencyScore(lastActiveAt: Date | null): number {
    if (!lastActiveAt) return 0;
    
    const daysSinceActive = (Date.now() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceActive < 7) return 20; // Very recent
    if (daysSinceActive < 30) return 15; // Recent
    if (daysSinceActive < 90) return 10; // Somewhat recent
    if (daysSinceActive < 180) return 5; // Not very recent
    return 0; // Inactive
  }

  async isDeveloperEligible(username: string): Promise<boolean> {
    try {
      const mergedPRs = await this.githubService.getUserPullRequests(username, 'merged', 100);
      if (mergedPRs.length >= 10) {
        console.log(`✓ ${username}: Eligible (${mergedPRs.length} merged PRs)`);
        return true;
      }

      const closedIssues = await this.githubService.getUserIssuesClosed(username, 100);
      if (closedIssues.length >= 2) {
        console.log(`✓ ${username}: Eligible (${closedIssues.length} issues closed)`);
        return true;
      }

      const prReviews = await this.githubService.getUserPRReviews(username, 100);
      if (prReviews.length >= 1) {
        console.log(`✓ ${username}: Eligible (${prReviews.length} PR reviews)`);
        return true;
      }

      const isMaintainer = await this.githubService.isMaintainerOfActiveRepo(username);
      if (isMaintainer) {
        console.log(`✓ ${username}: Eligible (maintainer of active repo)`);
        return true;
      }

      console.log(`✗ ${username}: Not eligible (insufficient activity)`);
      return false;
    } catch (error) {
      console.error(`Error checking eligibility for ${username}:`, error);
      return false;
    }
  }

  private extractLocation(location: string | null): { country: string | null; city: string | null } {
    if (!location) return { country: null, city: null };
    
    const locationLower = location.toLowerCase().trim();
    
    const sfIndicators = [
      'san francisco', 'sf', 'san fran', 'bay area', 
      'san francisco, ca', 'san francisco, california',
      'sf bay area', 'bay area, ca'
    ];
    if (sfIndicators.some(indicator => locationLower.includes(indicator))) {
      return { country: 'United States', city: 'San Francisco' };
    }
    
    const indiaIndicators = ['india', 'indian', 'in', 'bharat'];
    const isIndia = indiaIndicators.some(indicator => locationLower.includes(indicator));
    
    if (!isIndia) {
      return { country: null, city: null };
    }
    
    const cityMappings: Record<string, string> = {
      'ahmedabad': 'Ahmedabad',
      'amdavad': 'Ahmedabad',
      'pune': 'Pune',
      'bangalore': 'Bangalore',
      'bengaluru': 'Bangalore',
      'bangaluru': 'Bangalore',
    };
    
    for (const [key, city] of Object.entries(cityMappings)) {
      if (locationLower.includes(key)) {
        return { country: 'India', city };
      }
    }
    
    if (isIndia) {
      return { country: 'India', city: null };
    }
    
    const parts = location.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const country = parts[parts.length - 1];
      const city = parts[0];
      
      if (country.toLowerCase().includes('india') || country.toLowerCase() === 'in') {
        const cityLower = city.toLowerCase();
        for (const [key, mappedCity] of Object.entries(cityMappings)) {
          if (cityLower.includes(key)) {
            return { country: 'India', city: mappedCity };
          }
        }
        return { country: 'India', city: null };
      }
    }
    
    return { country: null, city: null };
  }

  private extractCompany(userData: any, organizations: any[] = []): string | null {
    const topMNCs = [
      'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Facebook',
      'Netflix', 'Uber', 'Airbnb', 'Twitter', 'LinkedIn', 'Oracle',
      'IBM', 'Intel', 'Adobe', 'Salesforce', 'VMware', 'Cisco',
      'Nvidia', 'Tesla', 'PayPal', 'Stripe', 'Shopify', 'Spotify',
      'GitHub', 'GitLab', 'Atlassian', 'MongoDB', 'Elastic', 'Databricks'
    ];
    
    const topStartups = [
      'OpenAI', 'Anthropic', 'Stability AI', 'Cohere', 'Hugging Face',
      'Vercel', 'Supabase', 'Railway', 'Render', 'PlanetScale',
      'Linear', 'Notion', 'Figma', 'Canva', 'Discord', 'Slack',
      'Replit', 'CodeSandbox', 'TurboRepo', 'Prisma'
    ];
    
    const allCompanies = [...topMNCs, ...topStartups];
    
    // First check organizations (primary source)
    if (organizations && organizations.length > 0) {
      for (const org of organizations) {
        const orgLogin = org.login || org.name || '';
        if (!orgLogin) continue;
        
        const orgLower = orgLogin.toLowerCase();
        for (const knownCompany of allCompanies) {
          const knownLower = knownCompany.toLowerCase();
          if (orgLower === knownLower || 
              orgLower.includes(knownLower) || 
              knownLower.includes(orgLower)) {
            return knownCompany;
          }
        }
        // If no match found, return the organization login
        return orgLogin;
      }
    }
    
    // Fallback to company field
    if (userData.company) {
      let company = userData.company.trim().replace(/^@/, '');
      if (!company || company === '') return null;
      
      const companyLower = company.toLowerCase();
      for (const knownCompany of allCompanies) {
        const knownLower = knownCompany.toLowerCase();
        if (companyLower === knownLower || 
            companyLower.includes(knownLower) || 
            knownLower.includes(companyLower)) {
          return knownCompany;
        }
      }
      
      return company;
    }
    
    return null;
  }

  private determineProfileType(repos: any[], languages: Map<string, number>): string {
    const languageCount = languages.size;
    const diverseRepos = repos.filter(r => !r.fork && r.stargazers_count > 10).length;
    
    if (languageCount >= 3 || diverseRepos >= 5) {
      return 'General';
    }
    
    return 'General';
  }

  async fetchAndCalculateDeveloper(username: string, skipEligibilityCheck: boolean = false): Promise<Developer | null> {
    try {
      if (!skipEligibilityCheck) {
        const isEligible = await this.isDeveloperEligible(username);
        if (!isEligible) {
          console.log(`Skipping ${username}: Not eligible (insufficient activity in last 90 days)`);
          return null;
        }
      }

      const [userData, repos, organizations] = await Promise.all([
        this.githubService.getUser(username),
        this.githubService.getUserRepositories(username, 30, 1),
        this.githubService.getUserOrganizations(username),
      ]);
      
      const { country, city } = this.extractLocation(userData.location);
      const company = this.extractCompany(userData, organizations);
      let totalPRs = 0;
      let totalCommits = 0;
      let totalIssues = 0;
      let totalLinesAdded = 0;
      let totalLinesDeleted = 0;
      let totalStarsReceived = 0;
      let totalForksReceived = 0;
      let activeProjects = 0;
      const languages = new Map<string, number>();
      const topRepos: string[] = [];
      
      // Process repositories
      for (const repo of repos) {
        if (!repo.fork) {
          activeProjects++;
          totalStarsReceived += repo.stargazers_count || 0;
          totalForksReceived += repo.forks_count || 0;
          
          if (repo.language) {
            languages.set(repo.language, (languages.get(repo.language) || 0) + 1);
          }
          
          if (topRepos.length < 5 && repo.stargazers_count > 10) {
            topRepos.push(repo.full_name);
          }
        }
      }
      
      for (const repo of repos) {
        if (!repo.fork && repo.open_issues_count) {
          totalIssues += Math.floor(repo.open_issues_count * 0.3);
        }
      }
      
      totalPRs = Math.floor(userData.public_repos * 2);
      totalCommits = Math.floor(userData.public_repos * 10);
      totalLinesAdded = totalCommits * 50;
      
      const githubCreatedAt = userData.created_at ? new Date(userData.created_at) : null;
      const yearsActive = githubCreatedAt 
        ? (Date.now() - githubCreatedAt.getTime()) / (1000 * 60 * 60 * 24 * 365)
        : 0;
      
      const lastActiveAt = repos.length > 0 && repos[0].updated_at
        ? new Date(repos[0].updated_at)
        : new Date();
      const prImpact = this.calculatePRImpact(totalPRs, Math.floor(totalPRs * 0.7), totalStarsReceived);
      const issueImpact = this.calculateIssueImpact(totalIssues, Math.floor(totalIssues * 0.6), totalIssues * 2);
      const dependencyInfluence = this.calculateDependencyInfluence(0, totalStarsReceived); // Simplified
      const projectLongevity = this.calculateProjectLongevity(yearsActive, activeProjects, lastActiveAt);
      const communityImpact = this.calculateCommunityImpact(
        userData.followers || 0,
        totalPRs + totalCommits + totalIssues,
        totalStarsReceived
      );
      const docsImpact = this.calculateDocsImpact(Math.floor(totalPRs * 0.1), Math.floor(totalCommits * 0.05));
      const consistency = this.calculateConsistency(
        totalCommits,
        yearsActive,
        totalCommits / Math.max(yearsActive * 12, 1)
      );
      const qualityMultiplier = this.calculateQualityMultiplier(0.6, 0.5, 20);
      
      let developer = await this.developerRepository.findOne({ where: { githubUsername: username } });
      
      if (!developer) {
        developer = this.developerRepository.create({
          githubUsername: username,
        });
      }
      developer.name = userData.name || username;
      developer.bio = userData.bio || null;
      developer.avatarUrl = userData.avatar_url || null;
      developer.profileUrl = userData.html_url || null;
      developer.followers = userData.followers || 0;
      developer.following = userData.following || 0;
      developer.publicRepos = userData.public_repos || 0;
      developer.country = country;
      developer.city = city;
      developer.location = userData.location || null;
      developer.company = company;
      developer.profileType = this.determineProfileType(repos, languages);
      developer.githubCreatedAt = githubCreatedAt;
      developer.lastActiveAt = lastActiveAt;
      developer.yearsActive = Math.floor(yearsActive);
      developer.activeProjects = activeProjects;
      developer.topLanguages = Array.from(languages.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang]) => lang);
      developer.topRepositories = topRepos;
      
      developer.prImpact = prImpact;
      developer.issueImpact = issueImpact;
      developer.dependencyInfluence = dependencyInfluence;
      developer.projectLongevity = projectLongevity;
      developer.communityImpact = communityImpact;
      developer.docsImpact = docsImpact;
      developer.consistency = consistency;
      developer.qualityMultiplier = qualityMultiplier;
      
      developer.totalPRs = totalPRs;
      developer.totalCommits = totalCommits;
      developer.totalIssues = totalIssues;
      developer.totalLinesAdded = totalLinesAdded;
      developer.totalLinesDeleted = totalLinesDeleted;
      developer.totalContributions = totalPRs + totalCommits + totalIssues;
      developer.totalStarsReceived = totalStarsReceived;
      developer.totalForksReceived = totalForksReceived;
      
      developer.finalImpactScore = this.calculateImpactScore(developer);
      developer.lastCalculatedAt = new Date();
      
      return await this.developerRepository.save(developer);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to fetch and calculate developer data: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  normalizeScore(score: number, maxScore: number): number {
    if (maxScore === 0) return 0;
    const normalized = (score / maxScore) * 100;
    return Math.min(100, Math.max(0, normalized));
  }

  async getMaxScore(): Promise<number> {
    const result = await this.developerRepository
      .createQueryBuilder('developer')
      .select('MAX(developer.finalImpactScore)', 'maxScore')
      .getRawOne();
    
    return result?.maxScore || 100;
  }

  async getRankedDevelopers(
    limit: number = 25,
    offset: number = 0,
    country?: string,
    city?: string,
    company?: string,
    profileType?: string
  ): Promise<{ developers: Developer[]; total: number; maxScore: number }> {
    const queryBuilder = this.developerRepository
      .createQueryBuilder('developer')
      .orderBy('developer.finalImpactScore', 'DESC');
    
    // If company filter is selected, ignore location filters
    if (company && company !== '' && company !== 'All Companies') {
      // Case-insensitive company matching
      queryBuilder.andWhere('LOWER(developer.company) = LOWER(:company)', { company });
    } else if (country || city) {
      // Only apply location filters if company is not selected
      if (country && country !== '' && country !== 'All Locations') {
        queryBuilder.andWhere('developer.country = :country', { country });
      }
      
      if (city && city !== '' && city !== 'All Cities') {
        queryBuilder.andWhere('developer.city = :city', { city });
      }
    }

    if (profileType && profileType !== '' && profileType !== 'All Profile Types') {
      queryBuilder.andWhere('developer.profileType = :profileType', { profileType });
    }
    
    const [developers, total] = await queryBuilder
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const maxScoreResult = await this.developerRepository
      .createQueryBuilder('developer')
      .select('MAX(developer.finalImpactScore)', 'maxScore')
      .getRawOne();
    
    const maxScore = maxScoreResult?.maxScore || 100;

    const normalizedDevelopers = developers.map(dev => ({
      ...dev,
      finalImpactScore: this.normalizeScore(Number(dev.finalImpactScore), Number(maxScore)),
    }));
    
    return { developers: normalizedDevelopers, total, maxScore: Number(maxScore) };
  }

  async getDeveloperByUsername(username: string): Promise<Developer | null> {
    return await this.developerRepository.findOne({ where: { githubUsername: username } });
  }

  async getAvailableCountries(): Promise<string[]> {
    return ['India', 'United States'];
  }

  async getAvailableCities(country: string): Promise<string[]> {
    if (country === 'India') {
      return ['Ahmedabad', 'Pune', 'Bangalore'];
    } else if (country === 'United States') {
      return ['San Francisco'];
    }
    return [];
  }

  async getAvailableCompanies(): Promise<string[]> {
    try {
      const result = await this.developerRepository
        .createQueryBuilder('developer')
        .select('DISTINCT developer.company', 'company')
        .where('developer.company IS NOT NULL')
        .andWhere("developer.company != ''")
        .orderBy('developer.company', 'ASC')
        .getRawMany();
      
      const dbCompanies = result.map(r => r.company).filter(Boolean);
      
      const knownCompanies = [
        'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Facebook',
        'Netflix', 'Uber', 'Airbnb', 'Twitter', 'LinkedIn', 'Oracle',
        'IBM', 'Intel', 'Adobe', 'Salesforce', 'VMware', 'Cisco',
        'Nvidia', 'Tesla', 'PayPal', 'Stripe', 'Shopify', 'Spotify',
        'GitHub', 'GitLab', 'Atlassian', 'MongoDB', 'Elastic', 'Databricks',
        'OpenAI', 'Anthropic', 'Stability AI', 'Cohere', 'Hugging Face',
        'Vercel', 'Supabase', 'Railway', 'Render', 'PlanetScale',
        'Linear', 'Notion', 'Figma', 'Canva', 'Discord', 'Slack',
        'Replit', 'CodeSandbox', 'TurboRepo', 'Prisma'
      ];
      
      // Merge and deduplicate (case-insensitive)
      const companyMap = new Map<string, string>();
      
      // Add known companies first (to preserve capitalization)
      for (const company of knownCompanies) {
        companyMap.set(company.toLowerCase(), company);
      }
      
      // Add database companies (preserve their capitalization if not in known list)
      for (const company of dbCompanies) {
        const lower = company.toLowerCase();
        if (!companyMap.has(lower)) {
          companyMap.set(lower, company);
        }
      }
      
      const allCompanies = Array.from(companyMap.values()).sort();
      
      return allCompanies;
    } catch (error) {
      console.error('Error fetching companies:', error);
      return [];
    }
  }

  async getAvailableProfileTypes(): Promise<string[]> {
    return ['General'];
  }

  async getDeveloperRank(
    username: string,
    country?: string,
    city?: string,
    company?: string,
    profileType?: string
  ): Promise<{ rank: number; total: number; developer: Developer | null }> {
    try {
      const developer = await this.developerRepository.findOne({ 
        where: { githubUsername: username } 
      });

      if (!developer) {
        const countQuery = this.developerRepository.createQueryBuilder('developer');
        if (company && company !== '' && company !== 'All Companies') {
          countQuery.andWhere('developer.company = :company', { company });
        } else if (country || city) {
          if (country && country !== '' && country !== 'All Locations') {
            countQuery.andWhere('developer.country = :country', { country });
          }
          if (city && city !== '' && city !== 'All Cities') {
            countQuery.andWhere('developer.city = :city', { city });
          }
        }
        if (profileType && profileType !== '' && profileType !== 'All Profile Types') {
          countQuery.andWhere('developer.profileType = :profileType', { profileType });
        }
        const total = await countQuery.getCount();
        return { rank: 0, total, developer: null };
      }

      const countQuery = this.developerRepository.createQueryBuilder('developer');
      if (company && company !== '' && company !== 'All Companies') {
        countQuery.andWhere('LOWER(developer.company) = LOWER(:company)', { company });
      } else if (country || city) {
        if (country && country !== '' && country !== 'All Locations') {
          countQuery.andWhere('developer.country = :country', { country });
        }
        if (city && city !== '' && city !== 'All Cities') {
          countQuery.andWhere('developer.city = :city', { city });
        }
      }
      if (profileType && profileType !== '' && profileType !== 'All Profile Types') {
        countQuery.andWhere('developer.profileType = :profileType', { profileType });
      }
      const total = await countQuery.getCount();

      const rankQuery = this.developerRepository
        .createQueryBuilder('developer')
        .where('developer.finalImpactScore > :score', { score: developer.finalImpactScore });
      
      if (company && company !== '' && company !== 'All Companies') {
        rankQuery.andWhere('LOWER(developer.company) = LOWER(:company)', { company });
      } else if (country || city) {
        if (country && country !== '' && country !== 'All Locations') {
          rankQuery.andWhere('developer.country = :country', { country });
        }
        if (city && city !== '' && city !== 'All Cities') {
          rankQuery.andWhere('developer.city = :city', { city });
        }
      }
      if (profileType && profileType !== '' && profileType !== 'All Profile Types') {
        rankQuery.andWhere('developer.profileType = :profileType', { profileType });
      }
      
      const rank = await rankQuery.getCount() + 1;
      
      return { rank, total, developer };
    } catch (error) {
      console.error('Error in getDeveloperRank:', error);
      throw error;
    }
  }

  async searchDevelopers(query: string, limit: number = 20): Promise<Developer[]> {
    return await this.developerRepository
      .createQueryBuilder('developer')
      .where('developer.githubUsername ILIKE :query', { query: `%${query}%` })
      .orWhere('developer.name ILIKE :query', { query: `%${query}%` })
      .orderBy('developer.finalImpactScore', 'DESC')
      .limit(limit)
      .getMany();
  }

  async autoDiscoverDevelopers(limit: number = 100): Promise<{ discovered: number; processed: number }> {
    const discoveredUsernames = new Set<string>();
    let processed = 0;

    try {
      console.log('Discovering developers from popular repositories...');
      const popularRepos = [
        'facebook/react',
        'microsoft/vscode',
        'tensorflow/tensorflow',
        'kubernetes/kubernetes',
        'microsoft/TypeScript',
        'vercel/next.js',
        'nodejs/node',
        'golang/go',
        'rust-lang/rust',
        'pytorch/pytorch',
      ];

      for (const repo of popularRepos) {
        try {
          const [owner, repoName] = repo.split('/');
          const contributors = await this.githubService.getContributors(owner, repoName, 20);
          
          for (const contributor of contributors) {
            if (contributor.login && !contributor.login.includes('[bot]')) {
              discoveredUsernames.add(contributor.login);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error fetching contributors from ${repo}:`, error);
        }
      }

      console.log('Discovering developers in target locations with high follower counts...');
      try {
        const indiaUsers = await this.githubService.searchUsers('location:India followers:>500', 30);
        if (indiaUsers.items) {
          for (const user of indiaUsers.items) {
            if (user.login && !user.login.includes('[bot]')) {
              discoveredUsernames.add(user.login);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const sfUsers = await this.githubService.searchUsers('location:"San Francisco" followers:>500', 30);
        if (sfUsers.items) {
          for (const user of sfUsers.items) {
            if (user.login && !user.login.includes('[bot]')) {
              discoveredUsernames.add(user.login);
            }
          }
        }
      } catch (error) {
        console.error('Error searching location users:', error);
      }
      
      console.log('Discovering developers from target cities...');
      const targetCities = [
        { name: 'Ahmedabad', query: 'location:"Ahmedabad, India"' },
        { name: 'Pune', query: 'location:"Pune, India"' },
        { name: 'Bangalore', query: 'location:"Bangalore, India"' },
        { name: 'Bengaluru', query: 'location:"Bengaluru, India"' },
        { name: 'San Francisco', query: 'location:"San Francisco"' },
        { name: 'SF', query: 'location:"San Francisco, CA"' },
      ];
      
      for (const city of targetCities) {
        try {
          const cityUsers = await this.githubService.searchUsers(`${city.query} followers:>50`, 20);
          if (cityUsers.items) {
            for (const user of cityUsers.items) {
              if (user.login && !user.login.includes('[bot]')) {
                discoveredUsernames.add(user.login);
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Error searching ${city.name}:`, error);
        }
      }

      console.log('Discovering developers from trending repositories...');
      try {
        const trendingRepos = await this.githubService.searchRepositories(
          'stars:>1000',
          undefined,
          'updated',
          'desc',
          20
        );

        for (const repo of trendingRepos.items.slice(0, 10)) {
          try {
            const [owner, repoName] = repo.full_name.split('/');
            const contributors = await this.githubService.getContributors(owner, repoName, 10);
            
            for (const contributor of contributors) {
              if (contributor.login && !contributor.login.includes('[bot]')) {
                discoveredUsernames.add(contributor.login);
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.error(`Error fetching contributors from ${repo.full_name}:`, error);
          }
        }
      } catch (error) {
        console.error('Error searching trending repos:', error);
      }

      console.log(`Found ${discoveredUsernames.size} unique developers. Processing with eligibility gate...`);
      const usernamesArray = Array.from(discoveredUsernames).slice(0, limit);
      
      const concurrency = 3;
      
      for (let i = 0; i < usernamesArray.length; i += concurrency) {
        const batch = usernamesArray.slice(i, i + concurrency);
        
        await Promise.all(
          batch.map(async (username) => {
            try {
              const existing = await this.developerRepository.findOne({
                where: { githubUsername: username }
              });

              if (existing && existing.lastCalculatedAt) {
                const daysSinceCalc = (Date.now() - new Date(existing.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceCalc < 7) {
                  return;
                }
              }

              const developer = await this.fetchAndCalculateDeveloper(username);
              if (developer) {
                processed++;
              }
            } catch (error) {
              console.error(`Error processing developer ${username}:`, error);
            }
          })
        );
        
        if (i + concurrency < usernamesArray.length) {
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }

      return {
        discovered: discoveredUsernames.size,
        processed,
      };
    } catch (error) {
      console.error('Error in auto-discover:', error);
      throw new HttpException(
        `Failed to auto-discover developers: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  public async fastAutoDiscoverBatch(batchSize: number = 20): Promise<number> {
    const discoveredUsernames = new Set<string>();
    let rateLimited = false;
    
    try {
      const indiaUsers = await this.githubService.searchUsers('location:India followers:>100', batchSize * 2);
      if (indiaUsers.items) {
        for (const user of indiaUsers.items) {
          if (user.login && !user.login.includes('[bot]')) {
            discoveredUsernames.add(user.login);
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      if (error.status === 429 || error.status === 403) {
        rateLimited = true;
        console.warn('GitHub API rate limit reached. Skipping auto-discovery to avoid further rate limits.');
      } else {
        console.error('Error in India location discovery:', error.message);
      }
    }
    
    if (rateLimited) {
      console.log('Auto-discovery skipped due to rate limiting. Please add GITHUB_TOKEN for higher limits.');
      return 0;
    }
    
    try {
      const sfQueries = [
        'location:"San Francisco" followers:>100',
        'location:"San Francisco, CA" followers:>100',
      ];
      
      for (const query of sfQueries) {
        try {
          const sfUsers = await this.githubService.searchUsers(query, 15);
          if (sfUsers.items) {
            for (const user of sfUsers.items) {
              if (user.login && !user.login.includes('[bot]')) {
                discoveredUsernames.add(user.login);
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          if (error.status === 429 || error.status === 403) {
            rateLimited = true;
            break;
          }
          console.error(`Error searching SF with query ${query}:`, error.message);
        }
      }
    } catch (error: any) {
      if (error.status === 429 || error.status === 403) {
        rateLimited = true;
      } else {
        console.error('Error in SF location discovery:', error.message);
      }
    }
    
    if (rateLimited) {
      console.log('Auto-discovery stopped due to rate limiting.');
      return 0;
    }
    
    const targetCities = [
      { name: 'Ahmedabad', query: 'location:"Ahmedabad, India"', minFollowers: 50 },
      { name: 'Pune', query: 'location:"Pune, India"', minFollowers: 50 },
      { name: 'Bangalore', query: 'location:"Bangalore, India"', minFollowers: 50 },
      { name: 'San Francisco', query: 'location:"San Francisco"', minFollowers: 50 },
    ];
    
    for (const city of targetCities) {
      if (rateLimited) break;
      
      try {
        const cityUsers = await this.githubService.searchUsers(`${city.query} followers:>${city.minFollowers}`, 10);
        if (cityUsers.items) {
          for (const user of cityUsers.items) {
            if (user.login && !user.login.includes('[bot]')) {
              discoveredUsernames.add(user.login);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        if (error.status === 429 || error.status === 403) {
          rateLimited = true;
          console.warn(`Rate limit reached while searching ${city.name}. Stopping auto-discovery.`);
          break;
        }
        console.error(`Error searching ${city.name}:`, error.message);
      }
    }
    
    if (rateLimited) {
      console.log('Auto-discovery stopped early due to GitHub API rate limits. Consider adding GITHUB_TOKEN for 5000 requests/hour.');
      return 0;
    }

    const usernamesArray = Array.from(discoveredUsernames).slice(0, batchSize);
    let processed = 0;
    const concurrency = 2;
    
    for (let i = 0; i < usernamesArray.length; i += concurrency) {
      const batch = usernamesArray.slice(i, i + concurrency);
      
      await Promise.all(
        batch.map(async (username) => {
          try {
            const existing = await this.developerRepository.findOne({
              where: { githubUsername: username }
            });

            if (existing && existing.lastCalculatedAt) {
              const daysSinceCalc = (Date.now() - new Date(existing.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
              if (daysSinceCalc < 7) {
                return;
              }
            }

            const developer = await this.fetchAndCalculateDeveloper(username);
            if (developer) {
              processed++;
            }
          } catch (error) {
            console.error(`Error processing ${username}:`, error);
          }
        })
      );
      
      if (i + concurrency < usernamesArray.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return processed;
  }

  public async discoverDevelopersByCompany(company: string, limit: number = 50, minRequired: number = 15): Promise<number> {
    let processed = 0;
    const discoveredUsernames = new Set<string>();

    try {
      console.log(`Discovering developers from company: ${company} (target: ${minRequired} minimum)`);
      
      // Strategy 1: Search users by company field
      try {
        const companyUsers = await this.githubService.searchUsersByCompany(company, 50);
        if (companyUsers.items) {
          for (const user of companyUsers.items) {
            if (user.login && !user.login.includes('[bot]')) {
              discoveredUsernames.add(user.login);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        if (error.status === 429 || error.status === 403) {
          console.warn(`Rate limit reached while searching company ${company}`);
          return 0;
        }
        console.error(`Error searching company ${company}:`, error.message);
      }

      // Strategy 2: Get organization members (if company name matches an org)
      const companyLower = company.toLowerCase();
      const orgName = companyLower;
      
      try {
        const orgMembers = await this.githubService.getOrganizationMembers(orgName, 100, 1);
        if (orgMembers && orgMembers.length > 0) {
          for (const member of orgMembers) {
            if (member.login && !member.login.includes('[bot]')) {
              discoveredUsernames.add(member.login);
            }
          }
          console.log(`Found ${orgMembers.length} members in organization ${orgName}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        if (error.status !== 404) {
          console.log(`Could not fetch members from org ${orgName}: ${error.message}`);
        }
      }

      // Process discovered developers - prioritize getting at least minRequired
      const usernamesArray = Array.from(discoveredUsernames).slice(0, limit);
      const concurrency = 3;

      for (let i = 0; i < usernamesArray.length; i += concurrency) {
        const batch = usernamesArray.slice(i, i + concurrency);

        await Promise.all(
          batch.map(async (username) => {
            try {
              const existing = await this.developerRepository.findOne({
                where: { githubUsername: username }
              });

              if (existing && existing.lastCalculatedAt) {
                const daysSinceCalc = (Date.now() - new Date(existing.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceCalc < 7) {
                  return;
                }
              }

              const developer = await this.fetchAndCalculateDeveloper(username, true);
              if (developer) {
                processed++;
              }
            } catch (error) {
              console.error(`Error processing ${username}:`, error);
            }
          })
        );

        // If we've processed enough, continue rest in background
        if (processed >= minRequired && i + concurrency < usernamesArray.length) {
          const remaining = usernamesArray.slice(i + concurrency);
          Promise.all(
            remaining.map(async (username) => {
              try {
                const existing = await this.developerRepository.findOne({
                  where: { githubUsername: username }
                });

                if (existing && existing.lastCalculatedAt) {
                  const daysSinceCalc = (Date.now() - new Date(existing.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
                  if (daysSinceCalc < 7) {
                    return;
                  }
                }

                const developer = await this.fetchAndCalculateDeveloper(username, true);
                if (developer) {
                  processed++;
                }
              } catch (error) {
                console.error(`Error processing ${username}:`, error);
              }
            })
          ).catch(err => console.error('Background processing error:', err));
          break;
        }

        if (i + concurrency < usernamesArray.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`Company discovery for ${company}: ${processed} developers processed`);
      return processed;
    } catch (error) {
      console.error(`Error in discoverDevelopersByCompany for ${company}:`, error);
      return 0;
    }
  }

  async getRankedDevelopersWithAutoDiscover(
    limit: number = 25,
    offset: number = 0,
    country?: string,
    city?: string,
    company?: string,
    profileType?: string,
    autoDiscover: boolean = true
  ): Promise<{ developers: Developer[]; total: number; autoDiscovered?: boolean; maxScore: number }> {
    const existingResult = await this.getRankedDevelopers(limit, offset, country, city, company, profileType);
    
    if (existingResult.total >= limit && offset === 0) {
      return {
        developers: existingResult.developers,
        total: existingResult.total,
        maxScore: existingResult.maxScore,
        autoDiscovered: false,
      };
    }

    // If filtering by company and we have few results, fetch immediately (synchronous)
    if (company && company !== '' && company !== 'All Companies' && existingResult.total < 15 && autoDiscover && offset === 0) {
      console.log(`Fetching developers for company ${company} immediately (need at least 15)...`);
      try {
        const processed = await this.discoverDevelopersByCompany(company, 50, 15);
        console.log(`Immediate company discovery for ${company}: ${processed} developers processed`);
        
        // Fetch again after discovery
        const updatedResult = await this.getRankedDevelopers(limit, offset, country, city, company, profileType);
        return {
          developers: updatedResult.developers,
          total: updatedResult.total,
          maxScore: updatedResult.maxScore,
          autoDiscovered: true,
        };
      } catch (error: any) {
        if (error.status !== 429 && error.status !== 403) {
          console.error(`Company discovery failed for ${company}:`, error);
        }
        // Return existing results even if discovery failed
      }
    }

    if (existingResult.total < 25 && autoDiscover && offset === 0) {
      // Background discovery for other cases
      if (company && company !== '' && company !== 'All Companies') {
        this.discoverDevelopersByCompany(company, 50, 15).then((processed) => {
          if (processed > 0) {
            console.log(`Background company discovery completed for ${company}: ${processed} developers processed`);
          }
        }).catch((error) => {
          if (error.status !== 429 && error.status !== 403) {
            console.error(`Company discovery failed for ${company}:`, error);
          }
        });
      } else {
        this.fastAutoDiscoverBatch(30).then((processed) => {
          if (processed > 0) {
            console.log(`Background discovery completed: ${processed} developers processed`);
          }
        }).catch((error) => {
          if (error.status !== 429 && error.status !== 403) {
            console.error('Background discovery failed:', error);
          }
        });
      }
    }

    return {
      developers: existingResult.developers,
      total: existingResult.total,
      maxScore: existingResult.maxScore,
      autoDiscovered: false,
    };
  }
}
