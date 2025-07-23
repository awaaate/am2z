import {
  createProcessor,
  chainProcessors,
  parallelProcessors,
  routeProcessor,
  batchProcessor,
  Success,
  Failure,
  ValidationError,
  ProcessorExecutionError,
  createAppState,
  createQueueRuntimeWithDefaults,
} from "am2z";
import type { AppState } from "am2z";
import { openai } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod";

// Content Generation State
interface ContentGenerationState extends AppState {
  // Input parameters
  topic: string;
  targetAudience: string;
  tone: "professional" | "casual" | "technical" | "friendly";
  contentType: "blog" | "social" | "email" | "all";
  
  // Generated content
  blogPost?: {
    title: string;
    content: string;
    excerpt: string;
    tags: string[];
    seoMetadata?: {
      metaDescription: string;
      keywords: string[];
    };
  };
  
  socialMediaPosts?: {
    twitter: string[];
    linkedin: string;
    facebook: string;
    instagram: string;
  };
  
  emailNewsletter?: {
    subject: string;
    preheader: string;
    body: string;
    callToAction: string;
  };
  
  // Quality metrics
  qualityScores?: {
    readability: number;
    engagement: number;
    seoScore: number;
    approved: boolean;
  };
  
  // Optimized versions
  optimizedContent?: any;
  
  // Publishing status
  publishingResults?: {
    blog?: { success: boolean; url?: string; error?: string };
    social?: { success: boolean; platforms: string[]; error?: string };
    email?: { success: boolean; recipients?: number; error?: string };
  };
}

// Schema for blog post generation
const BlogPostSchema = z.object({
  title: z.string().describe("Engaging blog post title"),
  content: z.string().describe("Full blog post content in markdown format"),
  excerpt: z.string().max(200).describe("Brief excerpt for previews"),
  tags: z.array(z.string()).describe("Relevant tags for categorization"),
  seoMetadata: z.object({
    metaDescription: z.string().max(160).describe("SEO meta description"),
    keywords: z.array(z.string()).describe("SEO keywords"),
  }),
});

// Schema for social media posts
const SocialMediaPostsSchema = z.object({
  twitter: z.array(z.string().max(280)).length(3).describe("3 Twitter posts"),
  linkedin: z.string().max(1300).describe("LinkedIn post"),
  facebook: z.string().max(500).describe("Facebook post"),
  instagram: z.string().max(2200).describe("Instagram caption"),
});

// Schema for email newsletter
const EmailNewsletterSchema = z.object({
  subject: z.string().max(100).describe("Email subject line"),
  preheader: z.string().max(150).describe("Email preheader text"),
  body: z.string().describe("Email body in HTML format"),
  callToAction: z.string().describe("Primary call-to-action text"),
});

// Schema for quality assessment
const QualityAssessmentSchema = z.object({
  readability: z.number().min(0).max(100).describe("Readability score"),
  engagement: z.number().min(0).max(100).describe("Engagement potential score"),
  seoScore: z.number().min(0).max(100).describe("SEO optimization score"),
  approved: z.boolean().describe("Whether content meets quality standards"),
  suggestions: z.array(z.string()).describe("Improvement suggestions"),
});

// Prompt builder helper
function buildSystemPrompt(tone: string, audience: string): string {
  const toneDescriptions = {
    professional: "formal, authoritative, and business-appropriate",
    casual: "conversational, friendly, and approachable",
    technical: "detailed, precise, and industry-specific",
    friendly: "warm, encouraging, and personable",
  };
  
  return `You are an expert content creator. Create content that is ${toneDescriptions[tone as keyof typeof toneDescriptions]} for ${audience}. 
  Ensure all content is engaging, valuable, and appropriate for the specified audience.`;
}

// Blog Post Generator
const generateBlogPost = createProcessor<ContentGenerationState>("generate-blog-post")
  .withDescription("Generate a comprehensive blog post using AI")
  .withTimeout(45000)
  .withRetryPolicy({
    maxAttempts: 2,
    backoffMs: 5000,
    shouldRetry: (error) => error.code === "rate_limit" || error.category === "network",
  })
  .process(async (state, ctx) => {
    ctx.log.info("Generating blog post", {
      topic: state.topic,
      audience: state.targetAudience,
      tone: state.tone,
    });
    
    try {
      const { object } = await generateObject({
        model: openai("gpt-4o"),
        schema: BlogPostSchema,
        system: buildSystemPrompt(state.tone, state.targetAudience),
        prompt: `Write a comprehensive blog post about "${state.topic}". 
        Make it informative, engaging, and valuable for ${state.targetAudience}.
        Include practical insights and actionable advice.`,
        temperature: 0.7,
        maxTokens: 3000,
      });
      
      ctx.log.info("Blog post generated successfully", {
        titleLength: object.title.length,
        contentLength: object.content.length,
        tagCount: object.tags.length,
      });
      
      return Success({
        ...state,
        blogPost: object,
      });
    } catch (error) {
      ctx.log.error("Blog post generation failed", error);
      return Failure(
        new ProcessorExecutionError(
          "generate-blog-post",
          ctx.meta.executionId,
          error instanceof Error ? error : new Error("Blog generation failed")
        )
      );
    }
  });

// Social Media Posts Generator
const generateSocialMediaPosts = createProcessor<ContentGenerationState>("generate-social-media")
  .withDescription("Generate posts for multiple social media platforms")
  .withTimeout(30000)
  .process(async (state, ctx) => {
    ctx.log.info("Generating social media posts");
    
    try {
      const { object } = await generateObject({
        model: openai("gpt-4o-mini"), // Faster model for shorter content
        schema: SocialMediaPostsSchema,
        system: buildSystemPrompt(state.tone, state.targetAudience),
        prompt: `Create engaging social media posts about "${state.topic}" for ${state.targetAudience}.
        
        Requirements:
        - Twitter: 3 different posts, each unique and engaging
        - LinkedIn: Professional post with insights
        - Facebook: Conversational post that encourages engagement
        - Instagram: Caption with relevant hashtags
        
        Make each platform-specific and optimize for engagement.`,
        temperature: 0.8, // Higher creativity for social
      });
      
      return Success({
        ...state,
        socialMediaPosts: object,
      });
    } catch (error) {
      return Failure(error);
    }
  });

// Email Newsletter Generator
const generateEmailNewsletter = createProcessor<ContentGenerationState>("generate-email")
  .withDescription("Generate email newsletter content")
  .withTimeout(30000)
  .process(async (state, ctx) => {
    ctx.log.info("Generating email newsletter");
    
    try {
      const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: EmailNewsletterSchema,
        system: buildSystemPrompt(state.tone, state.targetAudience),
        prompt: `Create an email newsletter about "${state.topic}" for ${state.targetAudience}.
        
        Make it:
        - Attention-grabbing subject line
        - Compelling preheader that complements the subject
        - Valuable body content with clear sections
        - Strong call-to-action that drives engagement
        
        Format the body in clean HTML with proper structure.`,
        temperature: 0.6,
      });
      
      return Success({
        ...state,
        emailNewsletter: object,
      });
    } catch (error) {
      return Failure(error);
    }
  });

// Quality Assessment Processor
const assessContentQuality = createProcessor<ContentGenerationState>("assess-quality")
  .withDescription("AI-powered quality assessment of generated content")
  .process(async (state, ctx) => {
    ctx.log.info("Assessing content quality");
    
    // Prepare content for assessment
    const contentToAssess = {
      blog: state.blogPost?.content || "",
      social: JSON.stringify(state.socialMediaPosts || {}),
      email: state.emailNewsletter?.body || "",
    };
    
    try {
      const { object } = await generateObject({
        model: openai("gpt-4o"),
        schema: QualityAssessmentSchema,
        system: "You are a content quality assessor. Evaluate content for readability, engagement potential, and SEO optimization.",
        prompt: `Assess the quality of this content:
        
        Blog Post: ${contentToAssess.blog.substring(0, 1000)}...
        Social Media: ${contentToAssess.social}
        Email: ${contentToAssess.email.substring(0, 500)}...
        
        Target Audience: ${state.targetAudience}
        Tone: ${state.tone}
        
        Provide scores and specific suggestions for improvement.`,
      });
      
      ctx.log.info("Quality assessment complete", {
        readability: object.readability,
        engagement: object.engagement,
        seoScore: object.seoScore,
        approved: object.approved,
      });
      
      return Success({
        ...state,
        qualityScores: {
          readability: object.readability,
          engagement: object.engagement,
          seoScore: object.seoScore,
          approved: object.approved,
        },
      });
    } catch (error) {
      return Failure(error);
    }
  });

// Content Optimization Processor
const optimizeContent = createProcessor<ContentGenerationState>("optimize-content")
  .withDescription("Optimize content based on quality assessment")
  .process(async (state, ctx) => {
    // Skip optimization if already approved
    if (state.qualityScores?.approved) {
      ctx.log.info("Content already approved, skipping optimization");
      return Success(state);
    }
    
    ctx.log.info("Optimizing content based on quality feedback");
    
    try {
      // Optimize blog post if needed
      if (state.blogPost && state.qualityScores && state.qualityScores.seoScore < 70) {
        const { text: optimizedContent } = await generateText({
          model: openai("gpt-4o"),
          system: "You are an SEO optimization expert.",
          prompt: `Optimize this blog post for better SEO while maintaining quality:
          
          Original: ${state.blogPost.content}
          
          Current SEO Score: ${state.qualityScores.seoScore}
          
          Improve keyword density, meta descriptions, and structure.`,
          maxTokens: 3000,
        });
        
        state.blogPost.content = optimizedContent;
      }
      
      return Success({
        ...state,
        optimizedContent: true,
        qualityScores: state.qualityScores ? {
          ...state.qualityScores,
          approved: true,
        } : undefined,
      });
    } catch (error) {
      return Failure(error);
    }
  });

// Mock Publishing Processors (replace with actual integrations)
const publishToBlog = createProcessor<ContentGenerationState>("publish-blog")
  .process(async (state, ctx) => {
    if (!state.blogPost) return Success(state);
    
    ctx.log.info("Publishing to blog platform");
    
    // Simulate blog publishing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return Success({
      ...state,
      publishingResults: {
        ...state.publishingResults,
        blog: {
          success: true,
          url: `https://blog.example.com/posts/${Date.now()}`,
        },
      },
    });
  });

const publishToSocialMedia = createProcessor<ContentGenerationState>("publish-social")
  .process(async (state, ctx) => {
    if (!state.socialMediaPosts) return Success(state);
    
    ctx.log.info("Publishing to social media platforms");
    
    // Simulate social media publishing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return Success({
      ...state,
      publishingResults: {
        ...state.publishingResults,
        social: {
          success: true,
          platforms: ["twitter", "linkedin", "facebook", "instagram"],
        },
      },
    });
  });

const sendEmailNewsletter = createProcessor<ContentGenerationState>("send-email")
  .process(async (state, ctx) => {
    if (!state.emailNewsletter) return Success(state);
    
    ctx.log.info("Sending email newsletter");
    
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return Success({
      ...state,
      publishingResults: {
        ...state.publishingResults,
        email: {
          success: true,
          recipients: 5420, // Mock subscriber count
        },
      },
    });
  });

// Parallel Content Generation
const generateAllContent = parallelProcessors<ContentGenerationState>({
  name: "generate-all-content",
  processors: [
    generateBlogPost,
    generateSocialMediaPosts,
    generateEmailNewsletter,
  ],
  timeout: 60000,
  mergeFunction: (results) => {
    // Merge all generated content
    const merged = results[0].state;
    
    results.forEach(result => {
      if (result.state.blogPost) merged.blogPost = result.state.blogPost;
      if (result.state.socialMediaPosts) merged.socialMediaPosts = result.state.socialMediaPosts;
      if (result.state.emailNewsletter) merged.emailNewsletter = result.state.emailNewsletter;
    });
    
    return merged;
  },
});

// Parallel Publishing
const publishAllContent = parallelProcessors<ContentGenerationState>({
  name: "publish-all-content",
  processors: [
    publishToBlog,
    publishToSocialMedia,
    sendEmailNewsletter,
  ],
  timeout: 30000,
});

// Content Type Router
const contentGenerationRouter = routeProcessor<ContentGenerationState>(
  "content-generation-router",
  (state) => state.contentType,
  {
    "blog": generateBlogPost,
    "social": generateSocialMediaPosts,
    "email": generateEmailNewsletter,
    "all": generateAllContent,
  }
);

// Complete Content Pipeline
export const contentGenerationPipeline = chainProcessors<ContentGenerationState>({
  name: "content-generation-pipeline",
  processors: [
    contentGenerationRouter,     // Generate content based on type
    assessContentQuality,        // Assess quality
    optimizeContent,            // Optimize if needed
    publishAllContent,          // Publish to all platforms
  ],
  timeout: 180000, // 3 minutes total
});

// Batch Content Generation for Multiple Topics
export const batchContentGeneration = (topics: string[], audience: string, tone: ContentGenerationState["tone"]) => {
  const payloads = topics.map(topic => 
    createAppState(`content-${topic}-${Date.now()}`, {
      topic,
      targetAudience: audience,
      tone,
      contentType: "all" as const,
    } as Omit<ContentGenerationState, keyof AppState>)
  );
  
  return batchProcessor<ContentGenerationState>({
    name: "batch-content-generation",
    processorName: "content-generation-pipeline",
    payloads,
  });
};

// Example usage with monitoring
async function main() {
  const runtime = createQueueRuntimeWithDefaults<ContentGenerationState>();
  
  // Register processors
  runtime.register(contentGenerationPipeline);
  
  // Set up monitoring
  runtime.on("processor:job:completed", (data) => {
    console.log(`✅ ${data.processorName} completed in ${data.executionTime}ms`);
  });
  
  runtime.on("processor:job:failed", (data) => {
    console.error(`❌ ${data.processorName} failed:`, data.error.message);
  });
  
  await runtime.start();
  
  // Example 1: Generate all content types
  const sessionId = `content-session-${Date.now()}`;
  
  try {
    const result = await runtime.executeInSession(
      "content-generation-pipeline",
      createAppState(sessionId, {
        topic: "10 Best Practices for Remote Work in 2024",
        targetAudience: "tech professionals and startup founders",
        tone: "professional",
        contentType: "all",
      }),
      sessionId
    );
    
    if (result.success) {
      console.log("\n📊 Content Generation Complete!");
      console.log("Blog Title:", result.state.blogPost?.title);
      console.log("Quality Scores:", result.state.qualityScores);
      console.log("Publishing Results:", result.state.publishingResults);
    }
  } finally {
    await runtime.stopSession(sessionId);
  }
  
  // Example 2: Batch generation for multiple topics
  const batchSession = `batch-content-${Date.now()}`;
  
  try {
    const batchJob = batchContentGeneration(
      [
        "AI Tools for Productivity",
        "Future of Remote Work",
        "Building High-Performance Teams",
      ],
      "business leaders and entrepreneurs",
      "professional"
    );
    
    runtime.register(batchJob);
    
    const batchResult = await runtime.executeInSession(
      "batch-content-generation",
      createAppState(batchSession, {}),
      batchSession
    );
    
    console.log("\n📦 Batch Generation Complete!");
    console.log("Total topics processed:", 3);
  } finally {
    await runtime.stopSession(batchSession);
    await runtime.stop();
  }
}

// Export individual processors for flexibility
export {
  generateBlogPost,
  generateSocialMediaPosts,
  generateEmailNewsletter,
  assessContentQuality,
  optimizeContent,
  publishToBlog,
  publishToSocialMedia,
  sendEmailNewsletter,
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}