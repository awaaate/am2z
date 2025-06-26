import { openai } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import { type AppState, createAppState } from "../lib/core/state";
import {
  createProcessor,
  chainProcessors,
  parallelProcessors,
} from "../lib/core/processor";
import { createQueueRuntimeWithDefaults } from "../lib/node/queue-runtime";
import { Success, Failure } from "../lib/core/result";
import { ProcessorExecutionError } from "../lib/core/errors";

// === ESQUEMAS DE VALIDACIÓN ===
const LandingRequirementsSchema = z.object({
  businessType: z
    .enum(["saas", "ecommerce", "portfolio", "agency", "startup", "course"])
    .catch("saas"),
  targetAudience: z.string(),
  primaryGoal: z
    .enum(["signups", "sales", "leads", "downloads", "bookings"])
    .catch("leads"),
  keyBenefits: z.array(z.string()),
  callToAction: z.string(),
  brandTone: z
    .enum([
      "professional",
      "friendly",
      "modern",
      "playful",
      "luxury",
      "minimal",
    ])
    .catch("professional"),
  industry: z.string(),
  competitorUrls: z.array(z.string()).optional(),
});

const HeroSectionSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  ctaText: z.string(),
  heroImage: z.string(), // Descripción para generar imagen
  features: z.array(z.string()),
});

const FeaturesSectionSchema = z.object({
  sectionTitle: z.string(),
  features: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string(), // Nombre del ícono
      benefit: z.string(),
    })
  ),
});

const TestimonialsSchema = z.object({
  sectionTitle: z.string(),
  testimonials: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      testimonial: z.string(),
      rating: z.number(),
      avatar: z.string(), // Descripción para avatar
    })
  ),
});

const PricingSectionSchema = z.object({
  sectionTitle: z.string(),
  plans: z.array(
    z.object({
      name: z.string(),
      price: z.string(),
      period: z.string(),
      features: z.array(z.string()),
      highlighted: z.boolean(),
      ctaText: z.string(),
    })
  ),
});

const DesignSystemSchema = z.object({
  colorPalette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    text: z.string(),
  }),
  typography: z.object({
    headingFont: z.string(),
    bodyFont: z.string(),
  }),
  layout: z.object({
    maxWidth: z.string(),
    spacing: z.enum(["tight", "normal", "spacious"]).catch("normal"),
    borderRadius: z.enum(["none", "small", "medium", "large"]).catch("medium"),
  }),
});

const SEODataSchema = z.object({
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  ogTitle: z.string(),
  ogDescription: z.string(),
  structuredData: z.string(), // JSON-LD
});

// === ESTADO DE LA APLICACIÓN ===
interface LandingPageState extends AppState {
  userRequest: string;
  requirements?: z.infer<typeof LandingRequirementsSchema>;
  heroSection?: z.infer<typeof HeroSectionSchema>;
  featuresSection?: z.infer<typeof FeaturesSectionSchema>;
  testimonials?: z.infer<typeof TestimonialsSchema>;
  pricingSection?: z.infer<typeof PricingSectionSchema>;
  designSystem?: z.infer<typeof DesignSystemSchema>;
  seoData?: z.infer<typeof SEODataSchema>;
  performanceOptimizations?: {
    criticalCSS: string;
    preloadResources: string[];
    lazyLoadImages: boolean;
  };
  finalHTML?: string;
  qualityScore?: number;
}

const model = openai("gpt-4o-mini");

// === PASO 1: ANÁLISIS DE REQUISITOS ===
const requirementsAnalyzer = createProcessor<LandingPageState>(
  "requirements-analyzer"
)
  .withDescription("Analiza los requisitos para la landing page")
  .withTimeout(45000) // 45 segundos para análisis completo
  .process(async (state, context) => {
    try {
      context.log.info("Analizando requisitos para landing page...", {
        request: state.userRequest,
      });

      const { object: requirements } = await generateObject({
        model,
        schema: LandingRequirementsSchema,
        system: `Eres un experto en marketing digital y conversión. Analiza solicitudes de landing pages y determina:
        1. Tipo de negocio
        2. Audiencia objetivo
        3. Objetivo principal de conversión
        4. Beneficios clave
        5. Call-to-action principal
        6. Tono de marca
        7. Industria`,
        prompt: `Analiza esta solicitud de landing page: ${state.userRequest}
        
        Identifica claramente el tipo de negocio, audiencia, objetivos y tono de marca.
        Si falta información, haz suposiciones inteligentes basadas en el contexto.`,
      });

      context.log.info("Requisitos analizados exitosamente", { requirements });
      return Success({
        ...state,
        requirements,
      });
    } catch (error) {
      context.log.error("Error analizando requisitos", error);
      return Failure(
        new ProcessorExecutionError(
          "requirements-analyzer",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PASO 2: GENERACIÓN PARALELA DE CONTENIDO ===
const heroGenerator = createProcessor<LandingPageState>("hero-generator")
  .withDescription("Genera la sección hero de la landing page")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "hero-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles")
        )
      );
    }

    try {
      context.log.info("Generando sección hero...");

      const { object: heroSection } = await generateObject({
        model,
        schema: HeroSectionSchema,
        system: `Eres un copywriter experto en conversión. Crea secciones hero que conviertan visitantes en clientes.
        El hero debe ser claro, convincente y alineado con el objetivo de conversión.`,
        prompt: `Crea una sección hero para:
        Negocio: ${state.requirements.businessType}
        Audiencia: ${state.requirements.targetAudience}
        Objetivo: ${state.requirements.primaryGoal}
        Beneficios: ${state.requirements.keyBenefits.join(", ")}
        CTA: ${state.requirements.callToAction}
        Tono: ${state.requirements.brandTone}
        
        El headline debe ser impactante y claro (máximo 8 palabras).
        El subheadline debe explicar el valor (máximo 20 palabras).
        Incluye 3-4 features destacadas.`,
      });

      context.log.info("Sección hero generada exitosamente");
      return Success({
        ...state,
        heroSection,
      });
    } catch (error) {
      context.log.error("Error generando hero", error);
      return Failure(
        new ProcessorExecutionError(
          "hero-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const featuresGenerator = createProcessor<LandingPageState>(
  "features-generator"
)
  .withDescription("Genera la sección de características/beneficios")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "features-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles")
        )
      );
    }

    try {
      context.log.info("Generando sección de features...");

      const { object: featuresSection } = await generateObject({
        model,
        schema: FeaturesSectionSchema,
        system: `Crea secciones de características que destaquen beneficios específicos y resultados tangibles.
        Cada feature debe responder a una necesidad específica de la audiencia.`,
        prompt: `Crea una sección de features para:
        Beneficios clave: ${state.requirements.keyBenefits.join(", ")}
        Audiencia: ${state.requirements.targetAudience}
        Negocio: ${state.requirements.businessType}
        
        Genera 4-6 features que conviertan características en beneficios.
        Cada feature debe tener un ícono apropiado (nombre de Heroicons).
        Enfócate en resultados y valor, no solo funcionalidades.`,
      });

      context.log.info("Sección de features generada");
      return Success({
        ...state,
        featuresSection,
      });
    } catch (error) {
      context.log.error("Error generando features", error);
      return Failure(
        new ProcessorExecutionError(
          "features-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const testimonialsGenerator = createProcessor<LandingPageState>(
  "testimonials-generator"
)
  .withDescription("Genera testimonios convincentes")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "testimonials-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles")
        )
      );
    }

    try {
      context.log.info("Generando testimonios...");

      const { object: testimonials } = await generateObject({
        model,
        schema: TestimonialsSchema,
        system: `Crea testimonios auténticos y específicos que aborden objeciones comunes y destaquen resultados.
        Los testimonios deben ser creíbles y variados en persona y empresa.`,
        prompt: `Genera testimonios para:
        Negocio: ${state.requirements.businessType}
        Audiencia: ${state.requirements.targetAudience}
        Beneficios: ${state.requirements.keyBenefits.join(", ")}
        Industria: ${state.requirements.industry}
        
        Crea 3-4 testimonios que:
        - Mencionen resultados específicos
        - Aborden diferentes aspectos del producto/servicio
        - Incluyan personas de diferentes roles/empresas
        - Sean específicos, no genéricos`,
      });

      context.log.info("Testimonios generados");
      return Success({
        ...state,
        testimonials,
      });
    } catch (error) {
      context.log.error("Error generando testimonios", error);
      return Failure(
        new ProcessorExecutionError(
          "testimonials-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const pricingGenerator = createProcessor<LandingPageState>("pricing-generator")
  .withDescription("Genera sección de precios estratégica")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "pricing-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles")
        )
      );
    }

    try {
      context.log.info("Generando sección de pricing...");

      const { object: pricingSection } = await generateObject({
        model,
        schema: PricingSectionSchema,
        system: `Diseña estrategias de pricing que maximicen conversiones usando principios psicológicos.
        Usa anclaje, escasez y contraste para guiar decisiones.`,
        prompt: `Crea pricing para:
        Negocio: ${state.requirements.businessType}
        Objetivo: ${state.requirements.primaryGoal}
        Audiencia: ${state.requirements.targetAudience}
        
        Genera 2-3 planes con:
        - Contraste claro entre opciones
        - Plan "recomendado" destacado
        - Features específicas por plan
        - Precios apropiados para la industria
        
        Si es un producto gratuito, crea planes freemium/premium.`,
      });

      context.log.info("Sección de pricing generada");
      return Success({
        ...state,
        pricingSection,
      });
    } catch (error) {
      context.log.error("Error generando pricing", error);
      return Failure(
        new ProcessorExecutionError(
          "pricing-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const designSystemGenerator = createProcessor<LandingPageState>(
  "design-system-generator"
)
  .withDescription("Genera sistema de diseño cohesivo")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "design-system-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles")
        )
      );
    }

    try {
      context.log.info("Generando sistema de diseño...");

      const { object: designSystem } = await generateObject({
        model,
        schema: DesignSystemSchema,
        system: `Eres un diseñador UX/UI experto. Crea sistemas de diseño que reflejen la marca y optimicen conversiones.
        Los colores deben evocar emociones apropiadas y la tipografía debe ser legible y moderna.`,
        prompt: `Diseña un sistema para:
        Tono de marca: ${state.requirements.brandTone}
        Negocio: ${state.requirements.businessType}
        Industria: ${state.requirements.industry}
        
        Crea:
        - Paleta de colores en formato Tailwind CSS (ej: blue-600)
        - Tipografías de Google Fonts apropiadas
        - Layout responsive y moderno
        - Elementos cohesivos con la marca`,
      });

      context.log.info("Sistema de diseño generado");
      return Success({
        ...state,
        designSystem,
      });
    } catch (error) {
      context.log.error("Error generando diseño", error);
      return Failure(
        new ProcessorExecutionError(
          "design-system-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PROCESAMIENTO PARALELO DE CONTENIDO ===
const contentGeneration = parallelProcessors<LandingPageState>({
  name: "content-generation",
  processors: [
    heroGenerator,
    featuresGenerator,
    testimonialsGenerator,
    pricingGenerator,
  ],
});

// === PASO 3: OPTIMIZACIONES EN CADENA ===
const seoOptimizer = createProcessor<LandingPageState>("seo-optimizer")
  .withDescription("Optimiza SEO y metadatos")
  .process(async (state, context) => {
    if (!state.requirements || !state.heroSection) {
      return Failure(
        new ProcessorExecutionError(
          "seo-optimizer",
          context.meta.executionId,
          new Error("Datos insuficientes para SEO")
        )
      );
    }

    try {
      context.log.info("Optimizando SEO...");

      const { object: seoData } = await generateObject({
        model,
        schema: SEODataSchema,
        system: `Eres un especialista en SEO técnico. Crea metadatos que mejoren rankings y CTR.
        Usa palabras clave estratégicas y cumple con mejores prácticas de SEO.`,
        prompt: `Optimiza SEO para:
        Headline: ${state.heroSection.headline}
        Negocio: ${state.requirements.businessType}
        Industria: ${state.requirements.industry}
        Beneficios: ${state.requirements.keyBenefits.join(", ")}
        
        Genera:
        - Title tag optimizado (50-60 caracteres)
        - Meta description compelling (150-160 caracteres)
        - Keywords relevantes (8-12 palabras)
        - Open Graph tags
        - Schema.org structured data para el tipo de negocio`,
      });

      context.log.info("SEO optimizado");
      return Success({
        ...state,
        seoData,
      });
    } catch (error) {
      context.log.error("Error optimizando SEO", error);
      return Failure(
        new ProcessorExecutionError(
          "seo-optimizer",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const performanceOptimizer = createProcessor<LandingPageState>(
  "performance-optimizer"
)
  .withDescription("Optimiza rendimiento y velocidad")
  .process(async (state, context) => {
    try {
      context.log.info("Optimizando rendimiento...");

      const { object: optimizations } = await generateObject({
        model,
        schema: z.object({
          criticalCSS: z.string(),
          preloadResources: z.array(z.string()),
          lazyLoadImages: z.boolean(),
        }),
        system: `Eres un experto en optimización web. Crea estrategias que mejoren Core Web Vitals y user experience.`,
        prompt: `Optimiza rendimiento para una landing page con:
        - Hero section
        - Features section  
        - Testimonials
        - Pricing section
        
        Genera:
        - Critical CSS mínimo para above-the-fold
        - Recursos para preload (fonts, imágenes críticas)
        - Estrategia de lazy loading
        - Prácticas de optimización`,
      });

      context.log.info("Rendimiento optimizado");
      return Success({
        ...state,
        performanceOptimizations: optimizations,
      });
    } catch (error) {
      context.log.error("Error optimizando rendimiento", error);
      return Failure(
        new ProcessorExecutionError(
          "performance-optimizer",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === CADENA DE OPTIMIZACIONES ===
const optimizationChain = chainProcessors<LandingPageState>({
  name: "optimization-chain",
  processors: [seoOptimizer, performanceOptimizer],
});

// === PASO 4: ENSAMBLAJE HTML FINAL ===
const htmlAssembler = createProcessor<LandingPageState>("html-assembler")
  .withDescription("Ensambla el HTML final de la landing page")
  .process(async (state, context) => {
    if (
      !state.heroSection ||
      !state.featuresSection ||
      !state.testimonials ||
      !state.pricingSection ||
      !state.designSystem ||
      !state.seoData
    ) {
      return Failure(
        new ProcessorExecutionError(
          "html-assembler",
          context.meta.executionId,
          new Error("Componentes incompletos para ensamblaje")
        )
      );
    }

    try {
      context.log.info("Ensamblando HTML final...");

      const { text: finalHTML } = await generateText({
        model,
        system: `Eres un desarrollador frontend experto. Ensambla landing pages HTML completas con Tailwind CSS.
        El HTML debe ser:
        - Semánticamente correcto
        - Responsive (mobile-first)
        - Optimizado para conversión
        - Accesible (ARIA labels)
        - Con Tailwind CSS inline
        - Funcional sin JavaScript externo`,
        prompt: `Ensambla una landing page HTML completa con estos elementos:

HERO SECTION:
${JSON.stringify(state.heroSection, null, 2)}

FEATURES SECTION:
${JSON.stringify(state.featuresSection, null, 2)}

TESTIMONIALS:
${JSON.stringify(state.testimonials, null, 2)}

PRICING:
${JSON.stringify(state.pricingSection, null, 2)}

DESIGN SYSTEM:
${JSON.stringify(state.designSystem, null, 2)}

SEO DATA:
${JSON.stringify(state.seoData, null, 2)}

PERFORMANCE OPTIMIZATIONS:
${JSON.stringify(state.performanceOptimizations, null, 2)}

Crea un HTML completo que incluya:
- DOCTYPE, head completo con SEO
- Tailwind CSS via CDN
- Estructura semántica (header, main, sections, footer)
- Hero section impactante
- Features section con iconos
- Testimonials section con avatars
- Pricing section destacada
- Footer con links importantes
- Botones CTA prominentes
- Responsive design
- Microinteracciones CSS
- Schema.org structured data

El HTML debe ser production-ready y optimizado para conversión.`,
      });

      context.log.info("HTML final ensamblado", {
        size: finalHTML.length,
      });

      return Success({
        ...state,
        finalHTML,
      });
    } catch (error) {
      context.log.error("Error ensamblando HTML", error);
      return Failure(
        new ProcessorExecutionError(
          "html-assembler",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PASO 5: CONTROL DE CALIDAD ===
const qualityAssurance = createProcessor<LandingPageState>("quality-assurance")
  .withDescription("Evalúa la calidad de la landing page")
  .process(async (state, context) => {
    if (!state.finalHTML) {
      return Failure(
        new ProcessorExecutionError(
          "quality-assurance",
          context.meta.executionId,
          new Error("HTML no disponible para QA")
        )
      );
    }

    try {
      context.log.info("Evaluando calidad de la landing page...");

      const { object: qualityReport } = await generateObject({
        model,
        schema: z.object({
          score: z.number().min(0).max(100),
          conversionOptimization: z.number().min(0).max(100),
          technicalQuality: z.number().min(0).max(100),
          seoScore: z.number().min(0).max(100),
          designScore: z.number().min(0).max(100),
          issues: z.array(z.string()),
          recommendations: z.array(z.string()),
          passesQuality: z.boolean(),
        }),
        system: `Eres un auditor experto en landing pages. Evalúa con criterios estrictos de conversión, técnica, SEO y diseño.`,
        prompt: `Audita esta landing page:

HTML: ${state.finalHTML}

Evalúa en estas dimensiones:
1. CONVERSIÓN: CTAs claros, flujo lógico, propuesta de valor
2. TÉCNICA: HTML válido, accesibilidad, rendimiento
3. SEO: Metadatos, estructura, palabras clave
4. DISEÑO: Jerarquía visual, responsive, consistencia

Proporciona puntuaciones específicas y recomendaciones accionables.`,
      });

      const qualityScore = qualityReport.score;

      context.log.info("Auditoría de calidad completada", {
        score: qualityScore,
        conversion: qualityReport.conversionOptimization,
        technical: qualityReport.technicalQuality,
        seo: qualityReport.seoScore,
        design: qualityReport.designScore,
      });

      return Success({
        ...state,
        qualityScore,
      });
    } catch (error) {
      context.log.error("Error en auditoría de calidad", error);
      return Failure(
        new ProcessorExecutionError(
          "quality-assurance",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === WORKFLOW PRINCIPAL ===
const landingPageWorkflow = chainProcessors<LandingPageState>({
  name: "landing-page-workflow",
  processors: [
    requirementsAnalyzer,
    parallelProcessors({
      name: "parallel-content-and-design",
      processors: [contentGeneration, designSystemGenerator],
    }),
    optimizationChain,
    htmlAssembler,
    qualityAssurance,
  ],
});

// === RUNTIME CONFIGURATION ===
const runtime = createQueueRuntimeWithDefaults<LandingPageState>({
  host: "localhost",
  port: 6379,
  db: 0,
});

// Registrar workflow
runtime.register(landingPageWorkflow);

export { runtime };

// === FUNCIÓN PRINCIPAL ===
export async function generateLandingPage(userRequest: string) {
  try {
    await runtime.start();
    console.log("🚀 Generador de Landing Pages iniciado");

    const baseState = createAppState("landing-gen-session");
    const initialState: LandingPageState = {
      ...baseState,
      userRequest,
    };

    console.log(`📄 Generando landing page para: "${userRequest}"`);

    const result = await runtime.execute("landing-page-workflow", initialState);

    if (result.success) {
      console.log("✅ Landing page generada exitosamente!");
      console.log("📊 Puntuación de calidad:", result.state.qualityScore);
      console.log(
        "📏 Tamaño HTML:",
        result.state.finalHTML?.length,
        "caracteres"
      );

      if (result.state.heroSection) {
        console.log("🎯 Headline:", result.state.heroSection.headline);
      }

      if (result.state.featuresSection) {
        console.log(
          "⚡ Features:",
          result.state.featuresSection.features.length
        );
      }

      if (result.state.testimonials) {
        console.log(
          "💬 Testimonios:",
          result.state.testimonials.testimonials.length
        );
      }

      if (result.state.pricingSection) {
        console.log(
          "💰 Planes de precio:",
          result.state.pricingSection.plans.length
        );
      }

      if (result.state.finalHTML) {
        console.log("\n=== PREVIEW DE LANDING PAGE ===");
        console.log(
          "HTML generado:",
          result.state.finalHTML.slice(0, 500) + "..."
        );

        // Opcionalmente guardar el HTML en un archivo
        // await Bun.write("landing-page.html", result.state.finalHTML);
        // console.log("💾 HTML guardado en landing-page.html");
      }
    } else {
      console.error("❌ Error generando landing page:", result.error?.message);
    }

    return result;
  } finally {
    await runtime.stop();
    console.log("🔄 Runtime detenido");
  }
}

// === EJEMPLO DE USO ===
if (import.meta.main) {
  await generateLandingPage(
    "Necesito una landing page para mi startup de inteligencia artificial que ayuda a empresas a automatizar su servicio al cliente. Nuestro producto usa chatbots avanzados y reduce hasta 80% el tiempo de respuesta. Target: CTOs y gerentes de tecnología de empresas medianas a grandes. Queremos conversiones para demos gratuitas."
  );
}
