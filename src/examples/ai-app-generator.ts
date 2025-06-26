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

// Esquemas de validación para las respuestas de IA
const AppRequirementsSchema = z.object({
  appType: z.enum(["dashboard", "ecommerce", "blog", "portfolio", "social"]),
  features: z.array(z.string()),
  techStack: z.object({
    frontend: z.string(),
    backend: z.string(),
    database: z.string(),
  }),
  complexity: z.enum(["simple", "medium", "complex"]),
  estimatedHours: z.number(),
});

const ComponentSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  dependencies: z.array(z.string()),
  code: z.string(),
  tests: z.string(),
});

const ApiEndpointSchema = z.object({
  path: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  description: z.string(),
  parameters: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
    })
  ),
  code: z.string(),
});

const DatabaseSchema = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          constraints: z.array(z.string()),
        })
      ),
    })
  ),
  migrations: z.string(),
  seedData: z.string(),
});

// Estado de la aplicación que extiende AppState
interface AppGeneratorState extends AppState {
  userRequest: string;
  requirements?: z.infer<typeof AppRequirementsSchema>;
  components?: z.infer<typeof ComponentSchema>[];
  apiEndpoints?: z.infer<typeof ApiEndpointSchema>[];
  database?: z.infer<typeof DatabaseSchema>;
  documentation?: string;
  deploymentConfig?: string;
  qualityScore?: number;
  generatedApp?: {
    frontend: string;
    backend: string;
    database: string;
    docs: string;
    deployment: string;
  };
}

// Configuración del modelo AI
const model = openai("gpt-4o-mini");

// === PASO 1: Análisis de Requisitos (Orquestador) ===
const requirementsAnalyzer = createProcessor<AppGeneratorState>(
  "requirements-analyzer"
)
  .withDescription(
    "Analiza los requisitos del usuario y planifica la aplicación"
  )
  .process(async (state, context) => {
    try {
      context.log.info("Analizando requisitos del usuario...", {
        request: state.userRequest,
      });

      const { object: requirements } = await generateObject({
        model,
        schema: AppRequirementsSchema,
        system: `Eres un arquitecto de software senior que analiza requisitos de usuarios y planifica aplicaciones web.
        Analiza la solicitud del usuario y determina:
        1. Tipo de aplicación
        2. Características necesarias
        3. Stack tecnológico apropiado
        4. Complejidad estimada
        5. Tiempo de desarrollo estimado en horas`,
        prompt: `Analiza esta solicitud de aplicación: ${state.userRequest}`,
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

// === PASO 2: Procesamiento Paralelo de Componentes ===
const frontendGenerator = createProcessor<AppGeneratorState>(
  "frontend-generator"
)
  .withDescription("Genera componentes frontend en paralelo")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "frontend-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles para frontend")
        )
      );
    }

    try {
      context.log.info("Generando componentes frontend...", {
        features: state.requirements.features,
      });

      // Generar componentes principales en paralelo
      const componentPromises = state.requirements.features.map(
        async (feature) => {
          const { object: component } = await generateObject({
            model,
            schema: ComponentSchema,
            system: `Eres un experto en desarrollo frontend con ${state.requirements?.techStack.frontend}.
          Genera componentes reutilizables, accesibles y con buenas prácticas.`,
            prompt: `Crea un componente para la característica: ${feature}
          Aplicación: ${state.requirements?.appType}
          Stack: ${state.requirements?.techStack.frontend}
          
          El componente debe ser completamente funcional y incluir:
          - Código limpio y documentado
          - Manejo de estado apropiado
          - Estilos responsive
          - Tests unitarios básicos`,
          });
          return component;
        }
      );

      const components = await Promise.all(componentPromises);

      context.log.info("Componentes frontend generados", {
        count: components.length,
      });

      return Success({
        ...state,
        components,
      });
    } catch (error) {
      context.log.error("Error generando frontend", error);
      return Failure(
        new ProcessorExecutionError(
          "frontend-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const backendGenerator = createProcessor<AppGeneratorState>("backend-generator")
  .withDescription("Genera endpoints de API en paralelo")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "backend-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles para backend")
        )
      );
    }

    try {
      context.log.info("Generando API endpoints...", {
        features: state.requirements.features,
      });

      // Generar endpoints para cada característica
      const endpointPromises = state.requirements.features.map(
        async (feature) => {
          const { object: endpoint } = await generateObject({
            model,
            schema: ApiEndpointSchema,
            system: `Eres un experto en desarrollo backend con ${state.requirements?.techStack.backend}.
          Diseña APIs RESTful siguiendo las mejores prácticas.`,
            prompt: `Crea un endpoint de API para la característica: ${feature}
          Aplicación: ${state.requirements?.appType}
          Stack: ${state.requirements?.techStack.backend}
          
          El endpoint debe incluir:
          - Validación de entrada
          - Manejo de errores
          - Documentación OpenAPI
          - Seguridad apropiada`,
          });
          return endpoint;
        }
      );

      const apiEndpoints = await Promise.all(endpointPromises);

      context.log.info("API endpoints generados", {
        count: apiEndpoints.length,
      });

      return Success({
        ...state,
        apiEndpoints,
      });
    } catch (error) {
      context.log.error("Error generando backend", error);
      return Failure(
        new ProcessorExecutionError(
          "backend-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const databaseGenerator = createProcessor<AppGeneratorState>(
  "database-generator"
)
  .withDescription("Genera esquema de base de datos")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "database-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles para database")
        )
      );
    }

    try {
      context.log.info("Generando esquema de base de datos...", {
        database: state.requirements.techStack.database,
      });

      const { object: database } = await generateObject({
        model,
        schema: DatabaseSchema,
        system: `Eres un experto en diseño de bases de datos con ${state.requirements?.techStack.database}.
        Diseña esquemas normalizados y eficientes.`,
        prompt: `Diseña el esquema de base de datos para:
        Aplicación: ${state.requirements?.appType}
        Características: ${state.requirements?.features.join(", ")}
        Base de datos: ${state.requirements?.techStack.database}
        
        Incluye:
        - Tablas normalizadas
        - Índices apropiados
        - Migraciones
        - Datos de prueba`,
      });

      context.log.info("Esquema de base de datos generado", {
        tables: database.tables.length,
      });

      return Success({
        ...state,
        database,
      });
    } catch (error) {
      context.log.error("Error generando base de datos", error);
      return Failure(
        new ProcessorExecutionError(
          "database-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PASO 3: Procesamiento Paralelo de Desarrollo ===
const parallelDevelopment = parallelProcessors<AppGeneratorState>({
  name: "parallel-development",
  processors: [frontendGenerator, backendGenerator, databaseGenerator],
});

// === PASO 4: Documentación y Despliegue (Secuencial) ===
const documentationGenerator = createProcessor<AppGeneratorState>(
  "documentation-generator"
)
  .withDescription("Genera documentación completa del proyecto")
  .process(async (state, context) => {
    if (!state.components || !state.apiEndpoints || !state.database) {
      return Failure(
        new ProcessorExecutionError(
          "documentation-generator",
          context.meta.executionId,
          new Error("Componentes incompletos para documentación")
        )
      );
    }

    try {
      context.log.info("Generando documentación...", {
        components: state.components.length,
        endpoints: state.apiEndpoints.length,
      });

      const { text: documentation } = await generateText({
        model,
        system: `Eres un experto en documentación técnica. Crea documentación completa y clara.`,
        prompt: `Genera documentación completa para esta aplicación:
        
        Tipo: ${state.requirements?.appType}
        Características: ${state.requirements?.features.join(", ")}
        
        Componentes Frontend: ${JSON.stringify(state.components, null, 2)}
        API Endpoints: ${JSON.stringify(state.apiEndpoints, null, 2)}
        Base de datos: ${JSON.stringify(state.database, null, 2)}
        
        La documentación debe incluir:
        - README completo
        - Guía de instalación
        - Documentación de API
        - Guía de desarrollo
        - Arquitectura del sistema`,
        abortSignal: context.signal,
      });

      context.log.info("Documentación generada exitosamente");

      return Success({
        ...state,
        documentation,
      });
    } catch (error) {
      context.log.error("Error generando documentación", error);
      return Failure(
        new ProcessorExecutionError(
          "documentation-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const deploymentConfigGenerator = createProcessor<AppGeneratorState>(
  "deployment-config-generator"
)
  .withDescription("Genera configuración de despliegue")
  .process(async (state, context) => {
    if (!state.requirements) {
      return Failure(
        new ProcessorExecutionError(
          "deployment-config-generator",
          context.meta.executionId,
          new Error("Requisitos no disponibles para deployment")
        )
      );
    }

    try {
      context.log.info("Generando configuración de despliegue...");

      const { text: deploymentConfig } = await generateText({
        model,
        system: `Eres un experto en DevOps y despliegue de aplicaciones. Crea configuraciones de despliegue robustas.`,
        prompt: `Genera configuración de despliegue para:
        
        Aplicación: ${state.requirements?.appType}
        Stack: ${JSON.stringify(state.requirements?.techStack)}
        Complejidad: ${state.requirements?.complexity}
        
        Incluye:
        - Docker Compose
        - Variables de entorno
        - Scripts de CI/CD
        - Configuración de Nginx
        - Monitoreo y logging`,
      });

      context.log.info("Configuración de despliegue generada");

      return Success({
        ...state,
        deploymentConfig,
      });
    } catch (error) {
      context.log.error("Error generando configuración de despliegue", error);
      return Failure(
        new ProcessorExecutionError(
          "deployment-config-generator",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PASO 5: Control de Calidad ===
const qualityAssurance = createProcessor<AppGeneratorState>("quality-assurance")
  .withDescription("Revisa la calidad del código generado")
  .process(async (state, context) => {
    if (
      !state.components ||
      !state.apiEndpoints ||
      !state.database ||
      !state.documentation
    ) {
      return Failure(
        new ProcessorExecutionError(
          "quality-assurance",
          context.meta.executionId,
          new Error("Aplicación incompleta para QA")
        )
      );
    }

    try {
      context.log.info("Ejecutando control de calidad...");

      const { object: qualityReport } = await generateObject({
        model,
        schema: z.object({
          score: z.number().min(0).max(100),
          issues: z.array(z.string()),
          recommendations: z.array(z.string()),
          passesQuality: z.boolean(),
        }),
        system: `Eres un experto en control de calidad de software. Evalúa código generado con criterios estrictos.`,
        prompt: `Revisa la calidad de esta aplicación generada:
        
        Componentes: ${JSON.stringify(state.components, null, 2)}
        API: ${JSON.stringify(state.apiEndpoints, null, 2)}
        Base de datos: ${JSON.stringify(state.database, null, 2)}
        
        Evalúa:
        - Calidad del código
        - Arquitectura
        - Seguridad
        - Rendimiento
        - Mantenibilidad
        - Completitud`,
      });

      const qualityScore = qualityReport.score;

      context.log.info("Control de calidad completado", {
        score: qualityScore,
        passed: qualityReport.passesQuality,
      });

      if (!qualityReport.passesQuality) {
        context.log.warn("La aplicación no pasó el control de calidad", {
          issues: qualityReport.issues,
        });
      }

      return Success({
        ...state,
        qualityScore,
      });
    } catch (error) {
      context.log.error("Error en control de calidad", error);
      return Failure(
        new ProcessorExecutionError(
          "quality-assurance",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

// === PASO 6: Ensamblaje Final (Condicional) ===
const finalAssembly = createProcessor<AppGeneratorState>("final-assembly")
  .withDescription("Ensambla la aplicación final")
  .process(async (state, context) => {
    if (state.qualityScore && state.qualityScore < 70) {
      return Failure(
        new ProcessorExecutionError(
          "final-assembly",
          context.meta.executionId,
          new Error(`Calidad insuficiente: ${state.qualityScore}/100`)
        )
      );
    }

    try {
      context.log.info("Ensamblando aplicación final...");

      const generatedApp = {
        frontend: state.components?.map((c) => c.code).join("\n\n") || "",
        backend: state.apiEndpoints?.map((e) => e.code).join("\n\n") || "",
        database: state.database?.migrations || "",
        docs: state.documentation || "",
        deployment: state.deploymentConfig || "",
      };

      context.log.info("Aplicación ensamblada exitosamente", {
        qualityScore: state.qualityScore,
      });

      return Success({
        ...state,
        generatedApp,
      });
    } catch (error) {
      context.log.error("Error en ensamblaje final", error);
      return Failure(
        new ProcessorExecutionError(
          "final-assembly",
          context.meta.executionId,
          error instanceof Error ? error : new Error(String(error))
        )
      );
    }
  });

const postProcessing = chainProcessors({
  name: "post-processing",
  processors: [documentationGenerator, deploymentConfigGenerator],
});
// === WORKFLOW PRINCIPAL ===
const appGeneratorWorkflow = chainProcessors<AppGeneratorState>({
  name: "app-generator-workflow",
  processors: [
    requirementsAnalyzer,
    parallelDevelopment,
    postProcessing,
    qualityAssurance,
    finalAssembly,
  ],
});

// Crear runtime distribuido con tipo correcto
const runtime = createQueueRuntimeWithDefaults<AppGeneratorState>({
  host: "localhost",
  port: 6379,
  db: 0,
});

// Registrar todos los procesadores
runtime.register(appGeneratorWorkflow);

//exportar runtime
export { runtime };

// === FUNCIÓN PRINCIPAL ===
export async function generateWebApp(userRequest: string) {
  try {
    await runtime.start();
    console.log("🚀 Sistema de generación de apps iniciado");

    // Estado inicial
    const baseState = createAppState("app-gen-session");
    const initialState: AppGeneratorState = {
      ...baseState,
      userRequest,
    };

    console.log(`📝 Generando aplicación para: "${userRequest}"`);

    // Ejecutar workflow principal
    const result = await runtime.execute(
      "app-generator-workflow",
      initialState
    );

    if (result.success) {
      console.log("✅ Aplicación generada exitosamente!");
      console.log("📊 Puntuación de calidad:", result.state.qualityScore);
      console.log(
        "📁 Componentes generados:",
        result.state.components?.length || 0
      );
      console.log("🔌 Endpoints API:", result.state.apiEndpoints?.length || 0);
      console.log(
        "🗄️ Tablas de BD:",
        result.state.database?.tables.length || 0
      );

      if (result.state.generatedApp) {
        console.log("\n=== APLICACIÓN GENERADA ===");
        console.log(
          "Frontend:",
          result.state.generatedApp.frontend.length,
          "caracteres"
        );
        console.log(
          "Backend:",
          result.state.generatedApp.backend.length,
          "caracteres"
        );
        console.log(
          "Base de datos:",
          result.state.generatedApp.database.length,
          "caracteres"
        );
        console.log(
          "Documentación:",
          result.state.generatedApp.docs.length,
          "caracteres"
        );
        console.log(
          "Despliegue:",
          result.state.generatedApp.deployment.length,
          "caracteres"
        );
      }
    } else {
      console.error("❌ Error generando aplicación:", result.error?.message);
    }

    return result;
  } finally {
    await runtime.stop();
    console.log("🔄 Runtime detenido");
  }
}

// Ejemplo de uso
if (import.meta.main) {
  await generateWebApp(
    "Quiero crear una tienda online para vender productos artesanales. Necesito un carrito de compras, gestión de inventario, procesamiento de pagos con Stripe, y un panel de administración para gestionar productos y pedidos."
  );
}
