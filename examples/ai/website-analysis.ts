import {
  createProcessor,
  chainProcessors,
  parallelProcessors,
  Failure,
  NetworkError,
  ProcessorExecutionError,
  Success,
  createAppState,
  createQueueRuntimeWithDefaults,
} from "am2z";
import type { AppState } from "am2z";
import FirecrawlApp from "@mendable/firecrawl-js";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

// Initialize Firecrawl for web scraping
const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

// Website Analysis State Interface
export interface WebsiteAnalysisState extends AppState {
  url: string;
  // Scraping results
  scrapedContent?: string;
  jsonContent?: any;
  markdownContent?: string;
  scrapingDuration?: number;
  scrapingMetadata?: {
    title?: string;
    description?: string;
  };
  // Individual AI analysis sections
  companyOverview?: string;
  productsAndServices?: string;
  brandIdentity?: string;
  targetAudience?: string;
  competitiveLandscape?: string;
  businessModel?: string;
  technologyAndInnovation?: string;
  cultureAndValues?: string;
  // Combined analysis
  analysisData?: string;
  content?: string;
  title?: string;
  description?: string;
  extractedAt: string;
  error?: string;
  isComplete?: boolean;
}

// Base prompt template for sections with language auto-detection
const createSectionPrompt = (sectionName: string, instructions: string) => {
  return `You are an expert business analyst specializing in ${sectionName} analysis. 

${instructions}

IMPORTANT LANGUAGE INSTRUCTION: Analyze the website content and respond in the SAME LANGUAGE as the website content. If the website is in Spanish, respond in Spanish. If it's in English, respond in English. If it's in French, respond in French, etc. Maintain the original language of the website throughout your analysis.

Guidelines:
- Be specific and detailed, avoid generic statements
- If information is not explicitly available, make reasonable inferences based on industry context
- Focus on concrete, actionable insights
- Maintain consistency with the website's original language
- If you cannot find specific information, indicate this clearly but provide educated estimates when appropriate`;
};

// Individual section prompts
const COMPANY_OVERVIEW_PROMPT = createSectionPrompt(
  "Company Overview",
  `Extract comprehensive company information. Provide a clear, structured analysis covering:

- Official company name and legal entity structure
- Primary industry and specific market sector
- Year founded and key historical milestones
- Geographic location(s) and markets served
- Company size, employee count, and scale indicators
- Corporate structure and ownership details

If specific information is not available, make reasonable inferences based on the available content and industry context. Be specific about what is stated vs. what is inferred.`
);

const PRODUCTS_SERVICES_PROMPT = createSectionPrompt(
  "Products and Services",
  `Identify and categorize all products and services. Provide a detailed analysis covering:

- Complete product/service portfolio with detailed descriptions
- Product categories and lines of business
- Key features, benefits, and differentiators for each offering
- Target markets and customer segments for each product/service
- Pricing models, tiers, or subscription options (if mentioned)
- Product lifecycle stage and market positioning

Organize this information clearly, grouping related products/services together. If pricing or specific details aren't available, note this but provide context about the market segment and value proposition.`
);

const BRAND_IDENTITY_PROMPT = createSectionPrompt(
  "Brand Identity",
  `Extract brand identity elements and messaging. Provide analysis covering:

- Mission statement and company purpose
- Vision for the future and aspirations
- Core values and guiding principles
- Brand personality traits and tone of voice
- Unique value proposition and key differentiators
- Market positioning and brand strategy
- Brand messaging and communication style

Focus on how the company presents itself to the market and what makes it unique. If formal statements aren't available, infer the brand identity from the overall messaging and positioning.`
);

const TARGET_AUDIENCE_PROMPT = createSectionPrompt(
  "Target Audience",
  `Identify target audience characteristics and customer segments. Analyze:

- Primary customer segments and demographics
- Customer personas and psychographics
- Specific pain points and challenges addressed
- Use cases and customer journey stages
- Geographic markets and regional focus
- Industry sectors served and vertical markets
- Customer size and business characteristics (SMB, Enterprise, etc.)

Be specific about who the company serves and how they describe their ideal customers. If explicit customer information isn't provided, infer from product descriptions and messaging.`
);

const COMPETITIVE_LANDSCAPE_PROMPT = createSectionPrompt(
  "Competitive Landscape",
  `Analyze competitive positioning and market dynamics. Cover:

- Direct and indirect competitors mentioned or implied
- Competitive advantages and unique strengths claimed
- Market position and leadership claims
- Key differentiators from competitors
- Competitive threats and market challenges mentioned
- Market leadership claims and positioning statements

Focus on how the company positions itself relative to competition and what advantages they claim to have.`
);

const BUSINESS_MODEL_PROMPT = createSectionPrompt(
  "Business Model",
  `Identify business model components and revenue approach. Analyze:

- Revenue streams and monetization strategies
- Business model type (B2B, B2C, B2B2C, marketplace, SaaS, etc.)
- Sales channels and distribution methods
- Partnership models and ecosystem approach
- Pricing strategy and value delivery model
- Customer acquisition and retention strategies

Focus on how the company makes money and delivers value to customers. If specific details aren't available, infer from the products/services and target market.`
);

const TECHNOLOGY_PROMPT = createSectionPrompt(
  "Technology and Innovation",
  `Extract technology-related information and innovation focus. Cover:

- Technology stack or platforms mentioned
- Innovation approach and R&D focus
- Digital capabilities and tech infrastructure
- Technical expertise areas and specializations
- Technology partnerships and integrations
- Digital transformation initiatives
- Technical competitive advantages

If the company isn't tech-focused, describe how they use technology to support their business or any digital initiatives mentioned.`
);

const CULTURE_PROMPT = createSectionPrompt(
  "Culture and Values",
  `Identify cultural and organizational elements. Analyze:

- Company culture and work environment descriptions
- Employee-focused initiatives and benefits
- Social responsibility and sustainability efforts
- Community involvement and charitable activities
- Diversity, equity, and inclusion commitments
- Corporate governance and ethical practices
- Environmental and social impact initiatives

Focus on how the company presents its values and culture to the public and employees.`
);

// Step 1: Website Scraping Processor
export const scrapeWebsiteContent = createProcessor<WebsiteAnalysisState>(
  "scrape-website-content"
)
  .withDescription("Scrape website content using Firecrawl")
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 5000,
    shouldRetry: (error: any) => error.category === "network",
  })
  .process(async (state, context) => {
    const { url } = state;
    const startTime = Date.now();

    context.log.info(
      `🕷️ [${context.meta.executionId}] WEBSITE SCRAPING STARTED`
    );
    context.log.info(`📋 Session: ${state.metadata.sessionId}`);
    context.log.info(`🔗 URL: ${url}`);

    // Emit scraping started event
    context.emit("website:scraping:started", {
      sessionId: state.metadata.sessionId,
      url,
      timestamp: new Date().toISOString(),
    });

    try {
      context.log.info("🌐 Fetching website content with Firecrawl");

      context.emit("website:scraping:progress", {
        sessionId: state.metadata.sessionId,
        url,
        status: "scraping",
        progress: 30,
        message: "Extracting website content...",
      });

      const firecrawlResponse = await app.scrapeUrl(url, {
        location: {
          country: "US",
          languages: ["en"],
        },
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
      });

      if (firecrawlResponse.error || !firecrawlResponse.success) {
        return Failure(
          new NetworkError(
            "https://api.firecrawl.dev/v1/scrape",
            400,
            new Error(firecrawlResponse.error || "Scraping failed")
          )
        );
      }

      // Get both JSON structured data and markdown content
      const jsonContent = firecrawlResponse.json;
      const markdownContent = firecrawlResponse.markdown;

      let scrapedContent = "";

      if (jsonContent) {
        // If we have structured JSON data, format it nicely
        scrapedContent = `**STRUCTURED DATA EXTRACTED:**\n\n${JSON.stringify(
          jsonContent,
          null,
          2
        )}\n\n`;
      }

      if (markdownContent) {
        // Add markdown content for additional context
        scrapedContent += `**WEBSITE CONTENT:**\n\n${markdownContent}`;
      }

      if (!scrapedContent && firecrawlResponse.html) {
        // Fallback to any content available
        scrapedContent = firecrawlResponse.html;
      }

      if (!scrapedContent) {
        return Failure(
          new ProcessorExecutionError(
            "scrape-website-content",
            "No content could be extracted from the website",
            new Error("No content could be extracted from the website")
          )
        );
      }

      const scrapingDuration = Date.now() - startTime;

      context.emit("website:scraping:completed", {
        sessionId: state.metadata.sessionId,
        url,
        contentLength: scrapedContent.length,
        duration: scrapingDuration,
        hasJson: !!jsonContent,
        hasMarkdown: !!markdownContent,
        progress: 100,
        message: "Website content extracted successfully!",
      });

      const updatedState: WebsiteAnalysisState = {
        ...state,
        scrapedContent,
        jsonContent,
        markdownContent,
        scrapingDuration,
        scrapingMetadata: {
          title: firecrawlResponse.metadata?.title,
          description: firecrawlResponse.metadata?.description,
        },
      };

      context.log.info(`✅ Website scraping completed for: ${url}`);
      context.log.info(
        `📊 Content length: ${scrapedContent.length} characters`
      );
      context.log.info(`⏱️ Scraping duration: ${scrapingDuration}ms`);

      return Success(updatedState);
    } catch (error) {
      context.log.error(`❌ Error scraping website ${url}:`, {
        error: error instanceof Error ? error.message : String(error),
      });

      context.emit("website:scraping:error", {
        sessionId: state.metadata.sessionId,
        url,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });

      return Failure(
        new ProcessorExecutionError(
          "scrape-website-content",
          context.meta.executionId,
          error instanceof Error ? error : new Error("Unknown error occurred")
        )
      );
    }
  });

// Individual Section Analysis Processors
export const analyzeCompanyOverviewSection =
  createProcessor<WebsiteAnalysisState>("analyze-company-overview-section")
    .withDescription("Analyze company overview information and update state")
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `🏢 [${context.meta.executionId}] COMPANY OVERVIEW ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o-mini"),
          system: COMPANY_OVERVIEW_PROMPT,
          prompt: `Analyze the following website content and extract company overview information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a comprehensive company overview analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, companyOverview: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing company overview:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-company-overview-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeProductsAndServicesSection =
  createProcessor<WebsiteAnalysisState>("analyze-products-services-section")
    .withDescription(
      "Analyze products and services information and update state"
    )
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `📦 [${context.meta.executionId}] PRODUCTS & SERVICES ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o"),
          system: PRODUCTS_SERVICES_PROMPT,
          prompt: `Analyze the following website content and extract products and services information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a detailed products and services analysis.`,
          maxTokens: 2000,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, productsAndServices: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing products & services:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-products-services-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeBrandIdentitySection =
  createProcessor<WebsiteAnalysisState>("analyze-brand-identity-section")
    .withDescription("Analyze brand identity information and update state")
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `🎯 [${context.meta.executionId}] BRAND IDENTITY ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o"),
          system: BRAND_IDENTITY_PROMPT,
          prompt: `Analyze the following website content and extract brand identity information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a comprehensive brand identity analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, brandIdentity: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing brand identity:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-brand-identity-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeTargetAudienceSection =
  createProcessor<WebsiteAnalysisState>("analyze-target-audience-section")
    .withDescription("Analyze target audience information and update state")
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `👥 [${context.meta.executionId}] TARGET AUDIENCE ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o-mini"),
          system: TARGET_AUDIENCE_PROMPT,
          prompt: `Analyze the following website content and extract target audience information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a detailed target audience analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, targetAudience: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing target audience:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-target-audience-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeCompetitiveLandscapeSection =
  createProcessor<WebsiteAnalysisState>("analyze-competitive-landscape-section")
    .withDescription(
      "Analyze competitive landscape information and update state"
    )
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `⚔️ [${context.meta.executionId}] COMPETITIVE LANDSCAPE ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o-mini"),
          system: COMPETITIVE_LANDSCAPE_PROMPT,
          prompt: `Analyze the following website content and extract competitive landscape information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a comprehensive competitive landscape analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, competitiveLandscape: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing competitive landscape:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-competitive-landscape-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeBusinessModelSection =
  createProcessor<WebsiteAnalysisState>("analyze-business-model-section")
    .withDescription("Analyze business model information and update state")
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `💼 [${context.meta.executionId}] BUSINESS MODEL ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o-mini"),
          system: BUSINESS_MODEL_PROMPT,
          prompt: `Analyze the following website content and extract business model information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a detailed business model analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, businessModel: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing business model:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-business-model-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

export const analyzeTechnologySection = createProcessor<WebsiteAnalysisState>(
  "analyze-technology-section"
)
  .withDescription(
    "Analyze technology and innovation information and update state"
  )
  .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
  .process(async (state, context) => {
    const { url, scrapedContent } = state;

    context.log.info(
      `🔬 [${context.meta.executionId}] TECHNOLOGY ANALYSIS STARTED`
    );

    try {
      const { text: sectionData } = await generateText({
        model: openai("gpt-4o-mini"),
        system: TECHNOLOGY_PROMPT,
        prompt: `Analyze the following website content and extract technology and innovation information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a comprehensive technology and innovation analysis.`,
        maxTokens: 1500,
        temperature: 0.3,
        abortSignal: context.signal,
      });

      return Success({ ...state, technologyAndInnovation: sectionData });
    } catch (error) {
      context.log.error(`❌ Error analyzing technology:`, error);
      return Failure(
        new ProcessorExecutionError(
          "analyze-technology-section",
          context.meta.executionId,
          error instanceof Error ? error : new Error("Unknown error occurred")
        )
      );
    }
  });

export const analyzeCultureAndValuesSection =
  createProcessor<WebsiteAnalysisState>("analyze-culture-values-section")
    .withDescription("Analyze culture and values information and update state")
    .withRetryPolicy({ maxAttempts: 2, backoffMs: 3000 })
    .process(async (state, context) => {
      const { url, scrapedContent } = state;

      context.log.info(
        `🌟 [${context.meta.executionId}] CULTURE & VALUES ANALYSIS STARTED`
      );

      try {
        const { text: sectionData } = await generateText({
          model: openai("gpt-4o-mini"),
          system: CULTURE_PROMPT,
          prompt: `Analyze the following website content and extract culture and values information:\n\nWEBSITE URL: ${url}\n\nCONTENT:\n${scrapedContent}\n\nProvide a detailed culture and values analysis.`,
          maxTokens: 1500,
          temperature: 0.3,
          abortSignal: context.signal,
        });

        return Success({ ...state, cultureAndValues: sectionData });
      } catch (error) {
        context.log.error(`❌ Error analyzing culture & values:`, error);
        return Failure(
          new ProcessorExecutionError(
            "analyze-culture-values-section",
            context.meta.executionId,
            error instanceof Error ? error : new Error("Unknown error occurred")
          )
        );
      }
    });

// Merge function for parallel results
function mergeParallelSectionResults(
  results: WebsiteAnalysisState[],
  originalState: WebsiteAnalysisState
): WebsiteAnalysisState {
  const updatedState = { ...originalState };

  // Process each result from parallel execution
  results.forEach((resultState) => {
    // Each result should have updated section data as text
    if (resultState.companyOverview) {
      updatedState.companyOverview = resultState.companyOverview;
    }
    if (resultState.productsAndServices) {
      updatedState.productsAndServices = resultState.productsAndServices;
    }
    if (resultState.brandIdentity) {
      updatedState.brandIdentity = resultState.brandIdentity;
    }
    if (resultState.targetAudience) {
      updatedState.targetAudience = resultState.targetAudience;
    }
    if (resultState.competitiveLandscape) {
      updatedState.competitiveLandscape = resultState.competitiveLandscape;
    }
    if (resultState.businessModel) {
      updatedState.businessModel = resultState.businessModel;
    }
    if (resultState.technologyAndInnovation) {
      updatedState.technologyAndInnovation =
        resultState.technologyAndInnovation;
    }
    if (resultState.cultureAndValues) {
      updatedState.cultureAndValues = resultState.cultureAndValues;
    }
  });

  // Combine all section analyses into a comprehensive analysis
  const analysisData = `# Complete Website Analysis

## Company Overview
${updatedState.companyOverview || "No company overview information available."}

## Products & Services
${
  updatedState.productsAndServices ||
  "No products and services information available."
}

## Brand Identity
${updatedState.brandIdentity || "No brand identity information available."}

## Target Audience
${updatedState.targetAudience || "No target audience information available."}

## Competitive Landscape
${
  updatedState.competitiveLandscape ||
  "No competitive landscape information available."
}

## Business Model
${updatedState.businessModel || "No business model information available."}

## Technology & Innovation
${
  updatedState.technologyAndInnovation ||
  "No technology and innovation information available."
}

## Culture & Values
${
  updatedState.cultureAndValues ||
  "No culture and values information available."
}`;

  return {
    ...updatedState,
    analysisData,
  };
}

// Parallel Processor: Run all section analyses in parallel
export const parallelSectionAnalysis = parallelProcessors<WebsiteAnalysisState>(
  {
    name: "parallel-section-analysis",
    processors: [
      analyzeCompanyOverviewSection,
      analyzeProductsAndServicesSection,
      analyzeBrandIdentitySection,
      analyzeTargetAudienceSection,
      analyzeCompetitiveLandscapeSection,
      analyzeBusinessModelSection,
      analyzeTechnologySection,
      analyzeCultureAndValuesSection,
    ],
    timeout: 180000, // 3 minutes for parallel analysis
    mergeFunction: mergeParallelSectionResults,
  }
);

// Step 3: Content Formatting Processor
export const formatAnalysisContent = createProcessor<WebsiteAnalysisState>(
  "format-analysis-content"
)
  .withDescription("Format AI analysis results into readable content")
  .process(async (state, context) => {
    const { url, analysisData, scrapingMetadata } = state;

    context.log.info(
      `📝 [${context.meta.executionId}] CONTENT FORMATTING STARTED`
    );
    context.log.info(`📋 Session: ${state.metadata.sessionId}`);
    context.log.info(`🔗 URL: ${url}`);

    if (!analysisData) {
      return Failure(
        new ProcessorExecutionError(
          "format-analysis-content",
          "No analysis data available for formatting",
          new Error("No analysis data available for formatting")
        )
      );
    }

    // Emit formatting started event
    context.emit("website:formatting:started", {
      sessionId: state.metadata.sessionId,
      url,
      timestamp: new Date().toISOString(),
    });

    try {
      context.log.info("🎨 Formatting analysis results");

      context.emit("website:formatting:progress", {
        sessionId: state.metadata.sessionId,
        url,
        status: "formatting",
        progress: 80,
        message: "Formatting content for display...",
      });

      // The analysisData is already formatted as readable content
      const readableContent = analysisData;

      // Extract final metadata
      const metadata = {
        title: scrapingMetadata?.title || "Website Analysis",
        description:
          scrapingMetadata?.description ||
          "Comprehensive business analysis of website content",
        extractedAt: new Date().toISOString(),
      };

      context.emit("website:formatting:completed", {
        sessionId: state.metadata.sessionId,
        url,
        contentLength: readableContent.length,
        companyName: "Analyzed Company",
        progress: 100,
        message: "Content formatting completed successfully!",
      });

      const updatedState: WebsiteAnalysisState = {
        ...state,
        content: readableContent,
        ...metadata,
        isComplete: true,
      };

      context.log.info(`✅ Content formatting completed for: ${url}`);
      context.log.info(
        `📄 Final content length: ${readableContent.length} characters`
      );

      return Success(updatedState);
    } catch (error) {
      context.log.error(`❌ Error formatting content for ${url}:`, {
        error: error instanceof Error ? error.message : String(error),
      });

      context.emit("website:formatting:error", {
        sessionId: state.metadata.sessionId,
        url,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });

      return Failure(
        new ProcessorExecutionError(
          "format-analysis-content",
          context.meta.executionId,
          error instanceof Error ? error : new Error("Unknown error occurred")
        )
      );
    }
  });

// Chain Processor: Complete Website Analysis Pipeline
export const analyzeWebsiteContent = chainProcessors<WebsiteAnalysisState>({
  name: "analyze-website-content",
  processors: [
    scrapeWebsiteContent,
    parallelSectionAnalysis,
    formatAnalysisContent,
  ],
  timeout: 300000, // 5 minutes total timeout
});

// Example usage
async function main() {
  // Create runtime
  const runtime = createQueueRuntimeWithDefaults<WebsiteAnalysisState>();
  
  // Register the workflow
  runtime.register(analyzeWebsiteContent);
  
  // Start runtime
  await runtime.start();
  
  // Create session ID for isolation
  const sessionId = `website-analysis-${Date.now()}`;
  
  try {
    // Execute analysis
    const result = await runtime.executeInSession(
      "analyze-website-content",
      createAppState(sessionId, {
        url: "https://example.com",
        extractedAt: new Date().toISOString(),
      }),
      sessionId
    );
    
    if (result.success) {
      console.log("Analysis completed successfully!");
      console.log("Title:", result.state.title);
      console.log("Analysis:", result.state.content);
    } else {
      console.error("Analysis failed:", result.error);
    }
  } finally {
    // Clean up session
    await runtime.stopSession(sessionId);
    // Stop runtime
    await runtime.stop();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}