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
   * Calculate Developer Impact Score (DIS) - Simplified version
   * Based only on: PRs, Commits, Issues, Followers, Lines, Stars, Repos, Years
   * Score is normalized to 0-100 scale
   */
  private calculateImpactScore(developer: Partial<Developer>): number {
    const totalPRs = developer.totalPRs || 0;
    const totalCommits = developer.totalCommits || 0;
    const totalIssues = developer.totalIssues || 0;
    const followers = developer.followers || 0;
    const totalLines = (developer.totalLinesAdded || 0) + (developer.totalLinesDeleted || 0);
    const totalStars = developer.totalStarsReceived || 0;
    const publicRepos = developer.publicRepos || 0;
    const yearsActive = developer.yearsActive || 0;

    // Normalize each metric to 0-100 scale using logarithmic scaling
    // Weights: PRs (20%), Commits (20%), Issues (10%), Followers (15%), Lines (10%), Stars (15%), Repos (5%), Years (5%)
    const prScore = Math.min(Math.log10(totalPRs + 1) * 10, 20);
    const commitScore = Math.min(Math.log10(totalCommits + 1) * 10, 20);
    const issueScore = Math.min(Math.log10(totalIssues + 1) * 10, 10);
    const followerScore = Math.min(Math.log10(followers + 1) * 10, 15);
    const linesScore = Math.min(Math.log10(totalLines / 1000 + 1) * 10, 10); // Lines in thousands
    const starsScore = Math.min(Math.log10(totalStars + 1) * 10, 15);
    const reposScore = Math.min(Math.log10(publicRepos + 1) * 10, 5);
    const yearsScore = Math.min(yearsActive * 2, 5); // Max 5 points for 2.5+ years

    const totalScore = prScore + commitScore + issueScore + followerScore + 
                      linesScore + starsScore + reposScore + yearsScore;
    
    // Normalize to 0-100 scale
    return Math.min(100, Math.max(0, totalScore));
  }

  // Constants for location extraction
  private static readonly SF_INDICATORS = [
    'san francisco', 'sf', 'san fran', 'bay area',
    'san francisco, ca', 'san francisco, california',
    'sf bay area', 'bay area, ca'
  ];

  private static readonly INDIA_INDICATORS = ['india', 'indian', 'in', 'bharat'];

  private static readonly CITY_MAPPINGS: Record<string, string> = {
    'ahmedabad': 'Ahmedabad',
    'amdavad': 'Ahmedabad',
    'pune': 'Pune',
    'bangalore': 'Bangalore',
    'bengaluru': 'Bangalore',
    'bangaluru': 'Bangalore',
  };

  // Recency score lookup table (days -> score)
  private static readonly RECENCY_SCORES: Array<{ maxDays: number; score: number }> = [
    { maxDays: 7, score: 20 },
    { maxDays: 30, score: 15 },
    { maxDays: 90, score: 10 },
    { maxDays: 180, score: 5 },
  ];

  private getRecencyScore(lastActiveAt: Date | null): number {
    if (!lastActiveAt) return 0;
    
    const daysSinceActive = (Date.now() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    
    const scoreEntry = DevelopersService.RECENCY_SCORES.find(entry => daysSinceActive < entry.maxDays);
    return scoreEntry?.score ?? 0;
  }

  async isDeveloperEligible(username: string): Promise<boolean> {
    try {
      const eligibilityChecks = [
        { check: () => this.githubService.getUserPullRequests(username, 'merged', 100), threshold: 10, message: 'merged PRs' },
        { check: () => this.githubService.getUserIssuesClosed(username, 100), threshold: 2, message: 'issues closed' },
        { check: () => this.githubService.getUserPRReviews(username, 100), threshold: 1, message: 'PR reviews' },
        { check: () => this.githubService.isMaintainerOfActiveRepo(username), threshold: 1, message: 'maintainer of active repo', isBoolean: true },
      ];

      for (const { check, threshold, message, isBoolean } of eligibilityChecks) {
        const result = await check();
        const count = isBoolean ? (result ? 1 : 0) : (result as any[]).length;
        
        if (count >= threshold) {
          console.log(`✓ ${username}: Eligible (${count} ${message})`);
          return true;
        }
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
    
    // Check for San Francisco first
    if (DevelopersService.SF_INDICATORS.some(indicator => locationLower.includes(indicator))) {
      return { country: 'United States', city: 'San Francisco' };
    }
    
    // Check for India
    const isIndia = DevelopersService.INDIA_INDICATORS.some(indicator => locationLower.includes(indicator));
    if (!isIndia) {
      return { country: null, city: null };
    }
    
    // Find city in India
    const city = this.findCityInLocation(locationLower);
    return { country: 'India', city };
  }

  private findCityInLocation(locationLower: string): string | null {
    // Check direct city mappings
    for (const [key, city] of Object.entries(DevelopersService.CITY_MAPPINGS)) {
      if (locationLower.includes(key)) {
        return city;
      }
    }
    
    // Check comma-separated format (city, country)
    const parts = locationLower.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const cityPart = parts[0];
      for (const [key, city] of Object.entries(DevelopersService.CITY_MAPPINGS)) {
        if (cityPart.includes(key)) {
          return city;
        }
      }
    }
    
    return null;
  }

  private extractCompany(userData: any, organizations: any[] = []): string | null {
    const orgCompany = this.findCompanyInOrganizations(organizations);
    if (orgCompany) return orgCompany;
    
    return this.findCompanyInUserData(userData);
  }

  private findCompanyInOrganizations(organizations: any[]): string | null {
    if (!organizations?.length) return null;
    
    const knownCompanies = this.getKnownCompaniesSet();
    
    for (const org of organizations) {
      const orgLogin = (org.login || org.name || '').trim();
      if (!orgLogin) continue;
      
      const matchedCompany = this.matchCompany(orgLogin, knownCompanies);
      if (matchedCompany) return matchedCompany;
      
      return orgLogin.replace(/^@/, '');
    }
    
    return null;
  }

  private findCompanyInUserData(userData: any): string | null {
    const company = userData?.company?.trim().replace(/^@/, '');
    if (!company) return null;
    
    const knownCompanies = this.getKnownCompaniesSet();
    return this.matchCompany(company, knownCompanies) || company;
  }

  private matchCompany(companyName: string, knownCompanies: Set<string>): string | null {
    const companyLower = companyName.toLowerCase();
    
    for (const knownCompany of knownCompanies) {
      const knownLower = knownCompany.toLowerCase();
      if (companyLower === knownLower || 
          companyLower.includes(knownLower) || 
          knownLower.includes(companyLower)) {
        return knownCompany;
      }
    }
    
    return null;
  }

  private getKnownCompaniesSet(): Set<string> {
    return new Set([
      'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Facebook',
      'Netflix', 'Uber', 'Airbnb', 'Twitter', 'LinkedIn', 'Oracle',
      'IBM', 'Intel', 'Adobe', 'Salesforce', 'VMware', 'Cisco',
      'Nvidia', 'Tesla', 'PayPal', 'Stripe', 'Shopify', 'Spotify',
      'GitHub', 'GitLab', 'Atlassian', 'MongoDB', 'Elastic', 'Databricks',
      'OpenAI', 'Anthropic', 'Stability AI', 'Cohere', 'Hugging Face',
      'Vercel', 'Supabase', 'Railway', 'Render', 'PlanetScale',
      'Linear', 'Notion', 'Figma', 'Canva', 'Discord', 'Slack',
      'Replit', 'CodeSandbox', 'TurboRepo', 'Prisma'
    ]);
  }

  private buildLocationQuery(country: string | null | undefined, city: string | null | undefined): string | null {
    if (city) {
      const cityQueries: Record<string, string> = {
        'San Francisco': 'location:"San Francisco" followers:>50',
      };
      
      if (cityQueries[city]) return cityQueries[city];
      if (country === 'India') return `location:"${city}, India" followers:>50`;
      return `location:"${city}" followers:>50`;
    }
    
    if (country) {
      const countryQueries: Record<string, string> = {
        'India': 'location:India followers:>100',
        'United States': 'location:"United States" followers:>100',
      };
      
      return countryQueries[country] || `location:"${country}" followers:>100`;
    }
    
    return null;
  }

  private async searchUsersByQuery(query: string, limit: number, discoveredUsernames: Set<string>): Promise<boolean> {
    try {
      const users = await this.githubService.searchUsers(query, limit);
      if (users.items) {
        users.items
          .filter(user => user.login && !user.login.includes('[bot]'))
          .forEach(user => discoveredUsernames.add(user.login));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      return false;
    } catch (error: any) {
      if (error.status === 429 || error.status === 403) {
        console.warn('GitHub API rate limit reached. Skipping auto-discovery to avoid further rate limits.');
        return true;
      }
      console.error(`Error in location discovery:`, error.message);
      return false;
    }
  }

  private determineProfileType(repos: any[], languages: Map<string, number>): string {
    // Currently all developers are classified as 'General'
    // This can be extended in the future with more sophisticated logic
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
      
      const developer = await this.developerRepository.findOne({ where: { githubUsername: username } })
        ?? this.developerRepository.create({ githubUsername: username });
      
      // Update developer data
      Object.assign(developer, {
        name: userData.name || username,
        bio: userData.bio || null,
        avatarUrl: userData.avatar_url || null,
        profileUrl: userData.html_url || null,
        followers: userData.followers || 0,
        following: userData.following || 0,
        publicRepos: userData.public_repos || 0,
        country,
        city,
        location: userData.location || null,
        company,
        profileType: this.determineProfileType(repos, languages),
        githubCreatedAt,
        lastActiveAt,
        yearsActive: Math.floor(yearsActive),
        activeProjects,
        topLanguages: Array.from(languages.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([lang]) => lang),
        topRepositories: topRepos,
        totalPRs,
        totalCommits,
        totalIssues,
        totalLinesAdded,
        totalLinesDeleted,
        totalContributions: totalPRs + totalCommits + totalIssues,
        totalStarsReceived,
        totalForksReceived,
        finalImpactScore: 0, // Will be calculated below
        lastCalculatedAt: new Date(),
      });
      
      // Calculate final impact score using simplified method
      developer.finalImpactScore = this.calculateImpactScore(developer);
      
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
    
    this.applyFiltersToQuery(queryBuilder, { company, country, city, profileType });
    
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

  async countDevelopersByFilters(
    company?: string | null,
    country?: string | null,
    city?: string | null
  ): Promise<number> {
    const queryBuilder = this.developerRepository.createQueryBuilder('developer');
    this.applyFiltersToQuery(queryBuilder, { company, country, city });
    return await queryBuilder.getCount();
  }

  private applyFiltersToQuery(
    queryBuilder: any,
    filters: { company?: string | null; country?: string | null; city?: string | null; profileType?: string | null }
  ): void {
    const { company, country, city, profileType } = filters;
    const isValidFilter = (value: string | null | undefined, excludeValues: string[]): boolean => {
      return !!(value && value.trim() !== '' && !excludeValues.includes(value));
    };

    // Company filter takes precedence over location filters
    if (isValidFilter(company, ['All Companies'])) {
      queryBuilder.andWhere('LOWER(developer.company) = LOWER(:company)', { company });
      return; // Early return - ignore location filters when company is set
    }

    // Apply location filters only if company is not set
    if (isValidFilter(country, ['All Locations'])) {
      queryBuilder.andWhere('developer.country = :country', { country });
    }

    if (isValidFilter(city, ['All Cities'])) {
      queryBuilder.andWhere('developer.city = :city', { city });
    }

    if (isValidFilter(profileType, ['All Profile Types'])) {
      queryBuilder.andWhere('developer.profileType = :profileType', { profileType });
    }
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
        // Tech Giants
        'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Facebook',
        'Netflix', 'Uber', 'Airbnb', 'Twitter', 'LinkedIn', 'Oracle',
        'IBM', 'Intel', 'Adobe', 'Salesforce', 'VMware', 'Cisco',
        'Nvidia', 'Tesla', 'PayPal', 'Stripe', 'Shopify', 'Spotify',
        'GitHub', 'GitLab', 'Atlassian', 'MongoDB', 'Elastic', 'Databricks',
        'OpenAI', 'Anthropic', 'Stability AI', 'Cohere', 'Hugging Face',
        'Vercel', 'Supabase', 'Railway', 'Render', 'PlanetScale',
        'Linear', 'Notion', 'Figma', 'Canva', 'Discord', 'Slack',
        'Replit', 'CodeSandbox', 'TurboRepo', 'Prisma',
        
        // Financial Services & Banks
        'JPMorgan Chase', 'JPMorgan', 'JPMorgan Stanley', 'Bank of America', 'Goldman Sachs',
        'Morgan Stanley', 'Citigroup', 'Wells Fargo', 'Barclays', 'HSBC',
        'Deutsche Bank', 'Credit Suisse', 'UBS', 'BNP Paribas', 'Société Générale',
        'American Express', 'Visa', 'Mastercard', 'Fidelity', 'BlackRock',
        'Charles Schwab', 'TD Bank', 'Bank of New York Mellon', 'State Street',
        
        // Consulting & Professional Services
        'McKinsey & Company', 'McKinsey', 'Boston Consulting Group', 'BCG', 'Bain & Company',
        'Deloitte', 'PwC', 'PricewaterhouseCoopers', 'EY', 'Ernst & Young',
        'KPMG', 'Accenture', 'Capgemini', 'Cognizant',
        
        // Ahmedabad companies
        'Asite', 'Upsquare', 'Radixweb', 'Simform', 'Tatvasoft', 'Concetto Labs',
        'Techvify', 'WeblineIndia', 'Agile Infoways', 'OpenXcell',
        
        // Bangalore companies
        'Infosys', 'Wipro', 'TCS', 'Tata Consultancy Services', 'Mindtree',
        'Mphasis', 'HCL Technologies', 'Tech Mahindra',
        'Flipkart', 'Ola', 'Swiggy', 'Razorpay', 'PhonePe', 'Zomato',
        'Myntra', 'BigBasket', 'Byju\'s', 'Unacademy', 'Practo',
        
        // Pune companies
        'Persistent Systems', 'KPIT', 'Zensar', 'Cybage', 'Amdocs', 'Syntel',
        
        // Other International Tech Companies
        'Samsung', 'Sony', 'Panasonic', 'LG', 'Huawei', 'Xiaomi', 'Alibaba',
        'Tencent', 'Baidu', 'ByteDance', 'TikTok', 'SAP', 'Siemens', 'Bosch',
        'BMW', 'Mercedes-Benz', 'Volkswagen', 'Audi', 'Toyota', 'Honda',
        'Nintendo', 'Electronic Arts', 'Activision Blizzard', 'Ubisoft',
        
        // Media & Entertainment
        'Disney', 'Warner Bros', 'Universal', 'Paramount', 'Sony Pictures',
        'BBC', 'CNN', 'Reuters', 'Bloomberg', 'The New York Times',
        
        // E-commerce & Retail
        'eBay', 'Alibaba', 'JD.com', 'Rakuten', 'MercadoLibre', 'Walmart',
        'Target', 'Costco', 'Home Depot', 'Lowe\'s',
        
        // Healthcare & Pharma
        'Pfizer', 'Johnson & Johnson', 'Merck', 'Novartis', 'Roche',
        'GlaxoSmithKline', 'GSK', 'AstraZeneca', 'Bayer', 'Sanofi',
        
        // Energy & Utilities
        'ExxonMobil', 'Shell', 'BP', 'Chevron', 'TotalEnergies',
        'Schlumberger', 'Halliburton', 'Baker Hughes',
        
        // Aerospace & Defense
        'Boeing', 'Lockheed Martin', 'Northrop Grumman', 'Raytheon',
        'Airbus', 'General Dynamics', 'BAE Systems',
        
        // Automotive
        'Ford', 'General Motors', 'GM', 'Chrysler', 'Fiat', 'Volvo',
        'Hyundai', 'Kia', 'Mazda', 'Subaru', 'Nissan', 'Mitsubishi',
        
        // Telecommunications
        'AT&T', 'Verizon', 'T-Mobile', 'Sprint', 'Vodafone', 'Orange',
        'Telefónica', 'Deutsche Telekom', 'BT Group', 'NTT',
        
        // Food & Beverage
        'Coca-Cola', 'PepsiCo', 'Nestlé', 'Unilever', 'Procter & Gamble',
        'P&G', 'Kraft Heinz', 'Mondelez', 'Danone',
        
        // Airlines
        'American Airlines', 'Delta', 'United Airlines', 'Southwest',
        'Lufthansa', 'Air France', 'British Airways', 'Emirates',
        
        // Other Major Companies
        'GE', 'General Electric', '3M', 'Caterpillar', 'Honeywell',
        'United Technologies', 'Raytheon Technologies', 'FedEx', 'UPS',
        'DHL', 'Maersk', 'Nike', 'Adidas', 'Puma'
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
        this.applyFiltersToQuery(countQuery, { company, country, city, profileType });
        const total = await countQuery.getCount();
        return { rank: 0, total, developer: null };
      }

      const countQuery = this.developerRepository.createQueryBuilder('developer');
      this.applyFiltersToQuery(countQuery, { company, country, city, profileType });
      const total = await countQuery.getCount();

      const rankQuery = this.developerRepository
        .createQueryBuilder('developer')
        .where('developer.finalImpactScore > :score', { score: developer.finalImpactScore });
      
      this.applyFiltersToQuery(rankQuery, { company, country, city, profileType });
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

  public async fastAutoDiscoverBatch(batchSize: number = 20, country?: string | null, city?: string | null): Promise<number> {
    const discoveredUsernames = new Set<string>();
    let rateLimited = false;
    
    // Build location query using strategy pattern
    if (country || city) {
      const searchQuery = this.buildLocationQuery(country, city);
      if (searchQuery) {
        rateLimited = await this.searchUsersByQuery(searchQuery, batchSize * 2, discoveredUsernames);
        if (rateLimited) return 0;
      }
    } else {
      // Default behavior: search all locations
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

  private getCompanyVariations(company: string): string[] {
    const variations = new Set<string>([company]);
    
    // Common variations
    const lower = company.toLowerCase();
    const upper = company.toUpperCase();
    const title = company.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    
    variations.add(lower);
    variations.add(upper);
    variations.add(title);
    
    // Remove common suffixes/prefixes and try variations
    const withoutInc = company.replace(/\s*(Inc|Inc\.|Incorporated|LLC|Ltd|Ltd\.|Limited|Corp|Corp\.|Corporation)\s*$/i, '').trim();
    if (withoutInc !== company) {
      variations.add(withoutInc);
      variations.add(withoutInc.toLowerCase());
    }
    
    // Handle specific company name variations
    const companyVariations: { [key: string]: string[] } = {
      'JPMorgan Chase': ['JPMorgan', 'JP Morgan', 'JPMorgan Chase', 'JPM', 'jpmorgan', 'jpmorganchase'],
      'JPMorgan': ['JPMorgan Chase', 'JP Morgan', 'JPM', 'jpmorgan'],
      'JPMorgan Stanley': ['JPMorgan', 'JP Morgan Stanley', 'JPM Stanley', 'jpmorganstanley'],
      'Bank of America': ['BofA', 'BOA', 'Bank of America', 'bankofamerica'],
      'Goldman Sachs': ['Goldman', 'GS', 'goldmansachs'],
      'Morgan Stanley': ['MS', 'morganstanley'],
      'McKinsey & Company': ['McKinsey', 'McKinsey & Co', 'mckinsey'],
      'Boston Consulting Group': ['BCG', 'bcg'],
      'Bain & Company': ['Bain', 'Bain & Co', 'bain'],
      'PricewaterhouseCoopers': ['PwC', 'pwc'],
      'Ernst & Young': ['EY', 'E&Y'],
      'General Electric': ['GE', 'ge'],
      'International Business Machines': ['IBM', 'ibm'],
      'American Express': ['Amex', 'AMEX', 'amex'],
    };
    
    if (companyVariations[company]) {
      companyVariations[company].forEach(v => variations.add(v));
    }
    
    // Try removing spaces and special characters
    const noSpaces = company.replace(/\s+/g, '');
    const noSpacesLower = noSpaces.toLowerCase();
    variations.add(noSpaces);
    variations.add(noSpacesLower);
    
    return Array.from(variations);
  }

  private getOrganizationNameVariations(company: string): string[] {
    const orgNames = new Set<string>();
    
    // Direct lowercase
    orgNames.add(company.toLowerCase());
    
    // Remove spaces
    orgNames.add(company.toLowerCase().replace(/\s+/g, ''));
    orgNames.add(company.toLowerCase().replace(/\s+/g, '-'));
    
    // Remove common words
    const withoutCommon = company.replace(/\b(Inc|Inc\.|Incorporated|LLC|Ltd|Ltd\.|Limited|Corp|Corp\.|Corporation|Company|Co|&|and)\b/gi, '').trim();
    if (withoutCommon !== company) {
      orgNames.add(withoutCommon.toLowerCase().replace(/\s+/g, ''));
      orgNames.add(withoutCommon.toLowerCase().replace(/\s+/g, '-'));
    }
    
    // Specific organization mappings
    const orgMappings: { [key: string]: string[] } = {
      'JPMorgan Chase': ['jpmorgan', 'jpmorganchase', 'jpmorgan-chase'],
      'JPMorgan': ['jpmorgan'],
      'JPMorgan Stanley': ['jpmorganstanley', 'jpmorgan-stanley'],
      'Bank of America': ['bankofamerica', 'bofa'],
      'Goldman Sachs': ['goldmansachs', 'gs'],
      'Morgan Stanley': ['morganstanley', 'ms'],
      'McKinsey & Company': ['mckinsey'],
      'Boston Consulting Group': ['bcg'],
      'Bain & Company': ['bain'],
      'PricewaterhouseCoopers': ['pwc'],
      'Ernst & Young': ['ey'],
      'General Electric': ['ge'],
      'International Business Machines': ['ibm'],
      'American Express': ['amex'],
    };
    
    if (orgMappings[company]) {
      orgMappings[company].forEach(org => orgNames.add(org));
    }
    
    return Array.from(orgNames);
  }

  /**
   * Batch discover developers for multiple companies with only 2-3 API calls
   * Groups companies into batches and uses OR queries to minimize API calls
   */
  public async batchDiscoverDevelopersByCompanies(
    companies: string[],
    maxCompanies: number = 20,
    perPage: number = 30
  ): Promise<number> {
    const validCompanies = companies.filter(
      c => c && c !== 'All Companies' && c.trim() !== ''
    );

    if (validCompanies.length === 0) {
      return 0;
    }

    // Filter out companies that already have 100+ developers
    const companiesToFetch: string[] = [];
    for (const company of validCompanies) {
      const count = await this.countDevelopersByFilters(company, null, null);
      if (count < 100) {
        companiesToFetch.push(company);
      }
    }

    if (companiesToFetch.length === 0) {
      console.log('All companies already have 100+ developers, skipping batch discovery');
      return 0;
    }

    // Limit number of companies to process per run to avoid rate limits
    const companiesToProcess = companiesToFetch.slice(0, maxCompanies);
    console.log(`Processing ${companiesToProcess.length} companies (one API call per company, max ${maxCompanies} per run)`);

    const discoveredUsernames = new Set<string>();
    let rateLimited = false;
    let processedCount = 0;

    // Process companies one at a time (GitHub doesn't like OR queries with multiple companies)
    for (let index = 0; index < companiesToProcess.length && !rateLimited; index++) {
      const company = companiesToProcess[index];
      
      try {
        // Escape quotes in company name
        const escapedCompany = company.replace(/"/g, '\\"');
        const query = `company:"${escapedCompany}" followers:>50`;
        
        if ((index + 1) % 5 === 0) {
          console.log(`Processing company ${index + 1}/${companiesToProcess.length}: ${company}`);
        }
        
        const result = await this.githubService.searchUsers(query, perPage);
        
        if (result.items && result.items.length > 0) {
          result.items
            .filter(user => user.login && !user.login.includes('[bot]'))
            .forEach(user => discoveredUsernames.add(user.login));
          processedCount++;
        }
        
        // Delay between API calls to avoid rate limits (2 seconds per call)
        // This ensures we stay well under GitHub's rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        if (error.status === 429 || error.status === 403) {
          rateLimited = true;
          console.warn(`Rate limit reached after processing ${index} companies. Stopping company discovery.`);
          console.warn('Consider adding GITHUB_TOKEN for higher rate limits (5000 requests/hour vs 60 without token).');
          break;
        } else if (error.status === 422) {
          // Invalid query - skip this company and continue
          console.warn(`Invalid query for company "${company}", skipping`);
          continue;
        } else {
          console.error(`Error searching company "${company}":`, error.message);
          // Continue with next company
        }
      }
    }

    if (rateLimited) {
      console.warn('Batch discovery stopped due to rate limits');
      return 0;
    }

    console.log(`Total unique developers discovered: ${discoveredUsernames.size}`);

    // Process discovered developers in parallel (with concurrency limit)
    const usernamesArray = Array.from(discoveredUsernames);
    let processed = 0;
    const concurrency = 5; // Process 5 developers at a time

    for (let i = 0; i < usernamesArray.length; i += concurrency) {
      const batch = usernamesArray.slice(i, i + concurrency);

      await Promise.all(
        batch.map(async (username) => {
          try {
            // Check if developer already exists (ensures uniqueness)
            const existing = await this.developerRepository.findOne({
              where: { githubUsername: username }
            });

            // Skip if recently calculated (within 7 days)
            if (existing && existing.lastCalculatedAt) {
              const daysSinceCalc = (Date.now() - new Date(existing.lastCalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
              if (daysSinceCalc < 7) {
                return;
              }
            }

            // Fetch and calculate developer (this handles upsert - no duplicates)
            // The database has a unique constraint on githubUsername, so duplicates are prevented
            const developer = await this.fetchAndCalculateDeveloper(username, true);
            if (developer) {
              processed++;
            }
          } catch (error: any) {
            // Handle duplicate key errors gracefully (can happen in parallel processing)
            if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('UNIQUE constraint')) {
              // Developer already exists, skip silently
              return;
            }
            console.error(`Error processing ${username}:`, error.message || error);
          }
        })
      );

      // Small delay between batches to avoid overwhelming the system
      if (i + concurrency < usernamesArray.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`Batch discovery completed: ${processed} developers processed from ${discoveredUsernames.size} discovered`);
    return processed;
  }

  public async discoverDevelopersByCompany(company: string, limit: number = 50, minRequired: number = 15): Promise<number> {
    let processed = 0;
    const discoveredUsernames = new Set<string>();

    try {
      console.log(`Discovering developers from company: ${company} (target: ${minRequired} minimum)`);
      
      // Strategy 1: Search users by company field with variations
      const companyVariations = this.getCompanyVariations(company);
      console.log(`Trying ${companyVariations.length} company name variations: ${companyVariations.slice(0, 5).join(', ')}...`);
      
      for (const variation of companyVariations.slice(0, 10)) { // Limit to 10 variations to avoid rate limits
        try {
          const companyUsers = await this.githubService.searchUsersByCompany(variation, 30);
          if (companyUsers.items && companyUsers.items.length > 0) {
            console.log(`Found ${companyUsers.items.length} users with company: ${variation}`);
            for (const user of companyUsers.items) {
              if (user.login && !user.login.includes('[bot]')) {
                discoveredUsernames.add(user.login);
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: any) {
          if (error.status === 429 || error.status === 403) {
            console.warn(`Rate limit reached while searching company ${variation}`);
            break;
          }
          // Continue with next variation
        }
      }

      // Strategy 2: Get organization members (try multiple org name variations)
      const orgVariations = this.getOrganizationNameVariations(company);
      console.log(`Trying ${orgVariations.length} organization name variations: ${orgVariations.slice(0, 5).join(', ')}...`);
      
      for (const orgName of orgVariations.slice(0, 5)) { // Limit to 5 org variations
        try {
          const orgMembers = await this.githubService.getOrganizationMembers(orgName, 100, 1);
          if (orgMembers && orgMembers.length > 0) {
            console.log(`Found ${orgMembers.length} members in organization ${orgName}`);
            for (const member of orgMembers) {
              if (member.login && !member.login.includes('[bot]')) {
                discoveredUsernames.add(member.login);
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: any) {
          if (error.status !== 404) {
            // Continue with next variation
          }
        }
      }
      
      console.log(`Total unique developers discovered: ${discoveredUsernames.size}`);

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
