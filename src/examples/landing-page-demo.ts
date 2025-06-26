// Demo script para probar el servidor de landing pages
import { createLogger } from "../lib/core/logging";

const logger = createLogger({ component: "LandingPageDemo" });
const SERVER_URL = "http://localhost:3001";

// Ejemplos de solicitudes para probar el generador
const testRequests = [
  {
    name: "Startup de IA",
    userRequest:
      "Necesito una landing page para mi startup de inteligencia artificial que ayuda a empresas a automatizar su servicio al cliente. Nuestro producto usa chatbots avanzados y reduce hasta 80% el tiempo de respuesta. Target: CTOs y gerentes de tecnología de empresas medianas a grandes. Queremos conversiones para demos gratuitas.",
  },
  {
    name: "Agencia de Marketing",
    userRequest:
      "Crea una landing page para mi agencia de marketing digital que ayuda a PyMEs a crecer online con SEO y ads. Target: dueños de pequeñas empresas que facturan entre $100K-$1M al año. Objetivo: agendar consultorías gratuitas de 30 minutos.",
  },
  {
    name: "Curso Online",
    userRequest:
      "Landing page para mi curso online de programación web full-stack. El curso dura 6 meses, incluye proyectos reales y garantiza trabajo o devolución del dinero. Target: personas sin experiencia en programación que quieren cambiar de carrera. Precio: $2,999 con opción de pago en cuotas.",
  },
  {
    name: "SaaS de Productividad",
    userRequest:
      "Necesito una landing para mi SaaS que ayuda a equipos remotos a organizarse mejor. Incluye gestión de tareas, tiempo tracking y reportes automáticos. Target: managers de equipos de 5-50 personas en startups y empresas tech. Freemium con plan pro a $15/usuario/mes.",
  },
  {
    name: "E-commerce de Artesanías",
    userRequest:
      "Landing page para mi tienda online de productos artesanales mexicanos hechos a mano. Vendemos textiles, cerámica y joyería directamente de artesanos. Target: personas de 25-45 años con poder adquisitivo medio-alto que valoran lo auténtico y sustentable. Objetivo: ventas directas.",
  },
];

async function makeRequest(url: string, method: string = "GET", body?: any) {
  try {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    return { status: response.status, data };
  } catch (error) {
    logger.error(`Error haciendo request a ${url}:`, error);
    return {
      status: 0,
      data: {
        error: error instanceof Error ? error.message : "Error desconocido",
      },
    };
  }
}

async function checkServerStatus() {
  logger.info("🔍 Verificando estado del servidor...");

  const result = await makeRequest(`${SERVER_URL}/api/status`);

  if (result.status === 200) {
    logger.info("✅ Servidor funcionando correctamente");
    console.log("Estado del sistema:", JSON.stringify(result.data, null, 2));
    return true;
  } else {
    logger.error("❌ Servidor no responde");
    console.log("Error:", result.data);
    return false;
  }
}

async function generateLandingPage(request: (typeof testRequests)[0]) {
  logger.info(`🎯 Generando landing page: ${request.name}`);

  const startTime = Date.now();
  const result = await makeRequest(`${SERVER_URL}/api/generate`, "POST", {
    userRequest: request.userRequest,
  });
  const duration = Date.now() - startTime;

  if (result.status === 200) {
    const data = result.data;

    logger.info(`✅ Landing page generada en ${duration}ms`);
    console.log(`\n=== ${request.name.toUpperCase()} ===`);
    console.log(`📁 Archivo: ${data.data.fileName}`);
    console.log(`🔗 URL: ${data.data.fullUrl}`);
    console.log(`📊 Calidad: ${data.data.qualityScore}/100`);
    console.log(`📏 Tamaño: ${data.metadata.htmlSize} caracteres`);
    console.log(`⏱️  Tiempo: ${data.metadata.executionTime}ms`);

    if (data.data.sections) {
      console.log(`🎯 Headline: "${data.data.sections.hero?.headline}"`);
      console.log(
        `⚡ Features: ${data.data.sections.features?.features.length}`
      );
      console.log(
        `💬 Testimonios: ${data.data.sections.testimonials?.testimonials.length}`
      );
      console.log(`💰 Planes: ${data.data.sections.pricing?.plans.length}`);
    }

    return data.data;
  } else {
    logger.error(`❌ Error generando landing page: ${result.data.error}`);
    console.log("Detalles del error:", result.data);
    return null;
  }
}

async function listGeneratedFiles() {
  logger.info("📋 Obteniendo lista de archivos generados...");

  const result = await makeRequest(`${SERVER_URL}/api/files`);

  if (result.status === 200) {
    const files = result.data.files;

    console.log(`\n=== ARCHIVOS GENERADOS (${files.length}) ===`);
    files.forEach((file: any, index: number) => {
      console.log(`${index + 1}. ${file.name}`);
      console.log(`   📁 URL: ${file.fullUrl}`);
      console.log(`   📏 Tamaño: ${(file.size / 1024).toFixed(1)} KB`);
      console.log(`   📅 Creado: ${new Date(file.created).toLocaleString()}`);
      console.log("");
    });

    return files;
  } else {
    logger.error("❌ Error obteniendo archivos");
    return [];
  }
}

async function runDemo(requestIndex?: number) {
  console.log("🚀 === DEMO DEL GENERADOR DE LANDING PAGES ===\n");

  // Verificar servidor
  const serverOk = await checkServerStatus();
  if (!serverOk) {
    console.log("\n💡 Para iniciar el servidor, ejecuta:");
    console.log("bun run src/examples/landing-page-server.ts");
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Generar landing page específica o todas
  if (requestIndex !== undefined && requestIndex < testRequests.length) {
    const request = testRequests[requestIndex];
    await generateLandingPage(request);
  } else {
    // Generar todas las landing pages de ejemplo
    logger.info("🎨 Generando múltiples landing pages...");

    for (let i = 0; i < testRequests.length; i++) {
      const request = testRequests[i];
      await generateLandingPage(request);

      // Pausa entre generaciones para no sobrecargar
      if (i < testRequests.length - 1) {
        logger.info(
          "⏳ Esperando 3 segundos antes de la siguiente generación..."
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Listar archivos generados
  await listGeneratedFiles();

  console.log("\n🎉 Demo completado!");
  console.log(
    "💡 Visita los enlaces generados en tu navegador para ver las landing pages."
  );
  console.log(`📊 Monitor del sistema: ${SERVER_URL}/admin/queues`);
}

// Función para ejecutar ejemplos específicos
export async function runSingleExample(index: number) {
  if (index < 0 || index >= testRequests.length) {
    console.log("❌ Índice inválido. Ejemplos disponibles:");
    testRequests.forEach((req, i) => {
      console.log(`${i}: ${req.name}`);
    });
    return;
  }

  await runDemo(index);
}

// Función para mostrar ayuda
export function showHelp() {
  console.log("🎯 === GENERADOR DE LANDING PAGES - DEMO ===\n");
  console.log("Comandos disponibles:");
  console.log("1. Ejecutar demo completo:");
  console.log("   bun run src/examples/landing-page-demo.ts");
  console.log("");
  console.log("2. Ejecutar ejemplo específico:");
  console.log("   bun run src/examples/landing-page-demo.ts [índice]");
  console.log("");
  console.log("Ejemplos disponibles:");
  testRequests.forEach((req, i) => {
    console.log(`   ${i}: ${req.name}`);
  });
  console.log("");
  console.log("3. Iniciar servidor:");
  console.log("   bun run src/examples/landing-page-server.ts");
  console.log("");
  console.log("4. Hacer request manual:");
  console.log(`   curl -X POST ${SERVER_URL}/api/generate \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"userRequest": "Tu descripción aquí..."}'`);
}

// Ejecutar si se llama directamente
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
  } else if (args.length > 0) {
    const index = parseInt(args[0]);
    if (!isNaN(index)) {
      runSingleExample(index);
    } else {
      console.log("❌ Argumento inválido. Usa --help para ver opciones.");
    }
  } else {
    runDemo();
  }
}

export { testRequests, runDemo };
