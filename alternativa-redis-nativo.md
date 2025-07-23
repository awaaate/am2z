# Alternativa: Sistema de Colas con Redis Nativo

## Arquitectura Propuesta

### Componentes Principales

1. **Queue Manager** - Gestiona las colas Redis
2. **Worker Pool** - Pool de workers para procesar trabajos
3. **Job Scheduler** - Programa y distribuye trabajos
4. **Session Manager** - Maneja aislamiento de sesiones
5. **State Manager** - Gestiona persistencia de estado

## Implementación Base

### 1. Queue Manager

```typescript
import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

export interface Job {
  id: string;
  type: string;
  data: any;
  priority: number;
  delay?: number;
  maxRetries: number;
  retryCount: number;
  createdAt: number;
  processedAt?: number;
  sessionId?: string;
}

export class RedisQueueManager extends EventEmitter {
  private redis: Redis;
  private subscribeRedis: Redis;
  private queueName: string;
  private processingSet: string;
  private delayedSet: string;
  private failedSet: string;
  
  constructor(queueName: string, redisConfig: any) {
    super();
    this.queueName = queueName;
    this.processingSet = `${queueName}:processing`;
    this.delayedSet = `${queueName}:delayed`;
    this.failedSet = `${queueName}:failed`;
    
    this.redis = new Redis(redisConfig);
    this.subscribeRedis = new Redis(redisConfig);
  }

  async addJob(job: Omit<Job, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
    const jobId = `${this.queueName}:${Date.now()}:${Math.random()}`;
    const fullJob: Job = {
      ...job,
      id: jobId,
      createdAt: Date.now(),
      retryCount: 0
    };

    if (job.delay && job.delay > 0) {
      // Trabajo con delay - agregar a delayed set
      const executeAt = Date.now() + job.delay;
      await this.redis.zadd(this.delayedSet, executeAt, JSON.stringify(fullJob));
    } else {
      // Trabajo inmediato - agregar a cola principal
      await this.redis.lpush(this.queueName, JSON.stringify(fullJob));
      // Notificar a workers
      await this.redis.publish(`${this.queueName}:new`, jobId);
    }

    return jobId;
  }

  async getJob(timeout: number = 10): Promise<Job | null> {
    // Bloquear hasta que haya un trabajo disponible
    const result = await this.redis.brpop(this.queueName, timeout);
    
    if (!result) return null;
    
    const job: Job = JSON.parse(result[1]);
    
    // Mover a conjunto de procesamiento
    await this.redis.sadd(this.processingSet, JSON.stringify(job));
    
    return job;
  }

  async completeJob(jobId: string): Promise<void> {
    // Remover del conjunto de procesamiento
    const processingJobs = await this.redis.smembers(this.processingSet);
    
    for (const jobStr of processingJobs) {
      const job: Job = JSON.parse(jobStr);
      if (job.id === jobId) {
        await this.redis.srem(this.processingSet, jobStr);
        this.emit('job:completed', job);
        break;
      }
    }
  }

  async failJob(jobId: string, error: Error): Promise<void> {
    const processingJobs = await this.redis.smembers(this.processingSet);
    
    for (const jobStr of processingJobs) {
      const job: Job = JSON.parse(jobStr);
      if (job.id === jobId) {
        await this.redis.srem(this.processingSet, jobStr);
        
        job.retryCount++;
        
        if (job.retryCount >= job.maxRetries) {
          // Mover a failed set
          await this.redis.sadd(this.failedSet, JSON.stringify({
            ...job,
            error: error.message,
            failedAt: Date.now()
          }));
          this.emit('job:failed', job, error);
        } else {
          // Reintento con backoff exponencial
          const delay = Math.pow(2, job.retryCount) * 1000;
          const executeAt = Date.now() + delay;
          await this.redis.zadd(this.delayedSet, executeAt, JSON.stringify(job));
          this.emit('job:retry', job, job.retryCount);
        }
        break;
      }
    }
  }

  async processDelayedJobs(): Promise<void> {
    const now = Date.now();
    const delayedJobs = await this.redis.zrangebyscore(
      this.delayedSet, 
      0, 
      now, 
      'WITHSCORES'
    );

    for (let i = 0; i < delayedJobs.length; i += 2) {
      const jobStr = delayedJobs[i];
      const score = delayedJobs[i + 1];
      
      // Remover del delayed set y agregar a cola principal
      await this.redis.zrem(this.delayedSet, jobStr);
      await this.redis.lpush(this.queueName, jobStr);
      await this.redis.publish(`${this.queueName}:new`, 'delayed_job');
    }
  }

  async getStats(): Promise<{
    waiting: number;
    processing: number;
    delayed: number;
    failed: number;
  }> {
    const [waiting, processing, delayed, failed] = await Promise.all([
      this.redis.llen(this.queueName),
      this.redis.scard(this.processingSet),
      this.redis.zcard(this.delayedSet),
      this.redis.scard(this.failedSet)
    ]);

    return { waiting, processing, delayed, failed };
  }
}
```

### 2. Worker Pool

```typescript
export class WorkerPool {
  private workers: Worker[] = [];
  private queueManager: RedisQueueManager;
  private processorMap: Map<string, ProcessorFunction> = new Map();
  private maxWorkers: number;
  private isRunning: boolean = false;

  constructor(queueManager: RedisQueueManager, maxWorkers: number = 5) {
    this.queueManager = queueManager;
    this.maxWorkers = maxWorkers;
  }

  registerProcessor(jobType: string, processor: ProcessorFunction): void {
    this.processorMap.set(jobType, processor);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    
    // Crear workers
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(i, this.queueManager, this.processorMap);
      this.workers.push(worker);
      worker.start();
    }

    // Procesador de trabajos delayed
    this.startDelayedJobProcessor();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Detener todos los workers
    await Promise.all(this.workers.map(worker => worker.stop()));
    this.workers = [];
  }

  private startDelayedJobProcessor(): void {
    const processDelayed = async () => {
      if (!this.isRunning) return;
      
      try {
        await this.queueManager.processDelayedJobs();
      } catch (error) {
        console.error('Error processing delayed jobs:', error);
      }
      
      // Procesar delayed jobs cada 5 segundos
      setTimeout(processDelayed, 5000);
    };

    processDelayed();
  }
}

class Worker {
  private id: number;
  private queueManager: RedisQueueManager;
  private processorMap: Map<string, ProcessorFunction>;
  private isRunning: boolean = false;

  constructor(
    id: number,
    queueManager: RedisQueueManager,
    processorMap: Map<string, ProcessorFunction>
  ) {
    this.id = id;
    this.queueManager = queueManager;
    this.processorMap = processorMap;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.processJobs();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  private async processJobs(): Promise<void> {
    while (this.isRunning) {
      try {
        const job = await this.queueManager.getJob(5); // 5 second timeout
        
        if (!job) continue;

        const processor = this.processorMap.get(job.type);
        if (!processor) {
          await this.queueManager.failJob(job.id, new Error(`No processor for job type: ${job.type}`));
          continue;
        }

        console.log(`Worker ${this.id} processing job ${job.id}`);
        
        const startTime = Date.now();
        try {
          await processor(job.data);
          await this.queueManager.completeJob(job.id);
          
          const duration = Date.now() - startTime;
          console.log(`Worker ${this.id} completed job ${job.id} in ${duration}ms`);
        } catch (error) {
          await this.queueManager.failJob(job.id, error as Error);
          console.error(`Worker ${this.id} failed job ${job.id}:`, error);
        }
      } catch (error) {
        console.error(`Worker ${this.id} error:`, error);
        // Breve pausa antes de continuar
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

type ProcessorFunction = (data: any) => Promise<void>;
```

### 3. Session Manager

```typescript
export class SessionManager {
  private redis: Redis;
  private sessionPrefix: string;

  constructor(redis: Redis, sessionPrefix: string = 'session') {
    this.redis = redis;
    this.sessionPrefix = sessionPrefix;
  }

  async createSession(sessionId: string, data: any): Promise<void> {
    const key = `${this.sessionPrefix}:${sessionId}`;
    await this.redis.hset(key, 'data', JSON.stringify(data));
    await this.redis.hset(key, 'createdAt', Date.now());
    await this.redis.expire(key, 3600); // 1 hora TTL
  }

  async getSession(sessionId: string): Promise<any | null> {
    const key = `${this.sessionPrefix}:${sessionId}`;
    const data = await this.redis.hget(key, 'data');
    return data ? JSON.parse(data) : null;
  }

  async updateSession(sessionId: string, data: any): Promise<void> {
    const key = `${this.sessionPrefix}:${sessionId}`;
    await this.redis.hset(key, 'data', JSON.stringify(data));
    await this.redis.hset(key, 'updatedAt', Date.now());
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `${this.sessionPrefix}:${sessionId}`;
    await this.redis.del(key);
  }

  async listSessions(): Promise<string[]> {
    const keys = await this.redis.keys(`${this.sessionPrefix}:*`);
    return keys.map(key => key.replace(`${this.sessionPrefix}:`, ''));
  }

  // Crear cola específica para sesión
  async createSessionQueue(sessionId: string): Promise<RedisQueueManager> {
    const queueName = `${this.sessionPrefix}:${sessionId}:queue`;
    return new RedisQueueManager(queueName, this.redis.options);
  }
}
```

### 4. Runtime Alternativo

```typescript
export class NativeRedisRuntime<T extends AppState> {
  private queueManager: RedisQueueManager;
  private workerPool: WorkerPool;
  private sessionManager: SessionManager;
  private processors: Map<string, ProcessorDefinition<T>> = new Map();

  constructor(redisConfig: any) {
    this.queueManager = new RedisQueueManager('am2z', redisConfig);
    this.workerPool = new WorkerPool(this.queueManager);
    this.sessionManager = new SessionManager(new Redis(redisConfig));
  }

  register(processor: ProcessorDefinition<T>): void {
    this.processors.set(processor.name, processor);
    
    // Registrar en worker pool
    this.workerPool.registerProcessor(processor.name, async (data) => {
      const { state, sessionId } = data;
      
      // Obtener estado actual de la sesión
      const currentState = sessionId 
        ? await this.sessionManager.getSession(sessionId) || state
        : state;
      
      // Ejecutar procesador
      const result = await processor.process(currentState, {
        log: console, // Implementar logger apropiado
        emit: (event: string, data: any) => {
          this.queueManager.emit(event, data);
        },
        signal: new AbortController().signal,
        meta: {
          executionId: `exec_${Date.now()}`,
          sessionId: sessionId
        }
      });

      if (result.success) {
        // Actualizar estado en sesión
        if (sessionId) {
          await this.sessionManager.updateSession(sessionId, result.state);
        }
      } else {
        throw new Error(result.error.message);
      }
    });
  }

  async start(): Promise<void> {
    await this.workerPool.start();
  }

  async stop(): Promise<void> {
    await this.workerPool.stop();
  }

  async execute(processorName: string, state: T, sessionId?: string): Promise<ProcessorResult<T>> {
    const processor = this.processors.get(processorName);
    if (!processor) {
      throw new Error(`Processor ${processorName} not found`);
    }

    // Crear sesión si no existe
    if (sessionId) {
      await this.sessionManager.createSession(sessionId, state);
    }

    // Agregar trabajo a la cola
    await this.queueManager.addJob({
      type: processorName,
      data: { state, sessionId },
      priority: 1,
      maxRetries: 3
    });

    // Para este ejemplo, retornamos inmediatamente
    // En implementación real, podrías esperar por el resultado
    return {
      success: true,
      state: state,
      executionTime: 0,
      metadata: {
        executionId: `exec_${Date.now()}`,
        sessionId: sessionId
      }
    };
  }

  async executeInSession(processorName: string, state: T, sessionId: string): Promise<ProcessorResult<T>> {
    return this.execute(processorName, state, sessionId);
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.sessionManager.deleteSession(sessionId);
  }

  async getStats(): Promise<any> {
    return this.queueManager.getStats();
  }
}
```

## Ventajas vs BullMQ

### ✅ Ventajas

1. **Menor overhead**: Sin abstracciones adicionales
2. **Control total**: Implementación customizable
3. **Dependencias mínimas**: Solo ioredis
4. **Comprensión**: Lógica clara y transparente
5. **Flexibilidad**: Adaptable a necesidades específicas

### ❌ Desventajas

1. **Más código**: Necesitas implementar más funcionalidad
2. **Mantenimiento**: Responsabilidad de bugs y actualizaciones
3. **Funcionalidades avanzadas**: Rate limiting, métricas, etc. requieren implementación
4. **Ecosistema**: Menos herramientas y plugins
5. **Battle-tested**: BullMQ tiene años de pruebas en producción

## Uso Ejemplo

```typescript
// Crear runtime
const runtime = new NativeRedisRuntime({
  host: 'localhost',
  port: 6379
});

// Registrar procesador
const processor = createProcessor<MyState>('test-processor')
  .process(async (state, ctx) => {
    // Tu lógica aquí
    return Success({ ...state, processed: true });
  });

runtime.register(processor);

// Iniciar
await runtime.start();

// Ejecutar
const result = await runtime.executeInSession(
  'test-processor',
  initialState,
  'session-123'
);
```

## Consideraciones

1. **Persistencia**: Esta implementación mantiene trabajos en memoria de Redis
2. **Escalabilidad**: Funciona bien para casos de uso moderados
3. **Monitoring**: Necesitarás implementar tu propio sistema de métricas
4. **Error handling**: Implementación básica de reintentos

Esta alternativa te da control total sobre el sistema de colas mientras mantiene la funcionalidad core de AM2Z.