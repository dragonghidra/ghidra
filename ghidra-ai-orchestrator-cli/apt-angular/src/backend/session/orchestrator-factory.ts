import { loadRuntimeConfig, RuntimeConfig } from '../config/runtime-config';
import { MockGateway } from '../gateways/mock-gateway';
import { LocalCliGateway } from '../gateways/local-cli-gateway';
import { AgentGateway } from '../gateways/gateway';
import { SessionOrchestrator } from './session-orchestrator';
import { RemoteAgentGateway } from '../gateways/remote-gateway';
import { MirrorFileGateway } from '../gateways/mirror-file-gateway';
import { PersistentGateway } from '../gateways/persistent-gateway';
import { JsonlStoreAdapter } from '../persistence/jsonl-store-adapter';
import { RedisStreamAdapter } from '../persistence/redis-stream-adapter';
import { TemporalWorkflowAdapter } from '../persistence/temporal-workflow-adapter';

export interface OrchestratorBundle {
  orchestrator: SessionOrchestrator;
  config: RuntimeConfig;
}

export const createSessionOrchestrator = async (
  config: RuntimeConfig = loadRuntimeConfig()
): Promise<OrchestratorBundle> => {
  const gateway = buildGateway(config);

  const orchestrator = new SessionOrchestrator(gateway);
  await orchestrator.init();

  return { orchestrator, config };
};

const buildGateway = (config: RuntimeConfig): AgentGateway => {
  switch (config.source) {
    case 'mirror-file':
      if (!config.mirrorFile) {
        throw new Error('Missing mirror file configuration');
      }

      return new MirrorFileGateway(config.mirrorFile);
    case 'local-cli':
      if (!config.localCli) {
        throw new Error('Missing local CLI configuration');
      }

      return new LocalCliGateway(config.localCli);
    case 'remote-cloud':
      if (!config.remote?.baseUrl) {
        throw new Error('REMOTE_AGENT_URL is required to use remote-cloud mode.');
      }

      return new RemoteAgentGateway(config.remote);
    case 'jsonl-store':
      if (!config.jsonlStore) {
        throw new Error('JSONL store configuration missing');
      }

      return new PersistentGateway(
        new JsonlStoreAdapter(config.jsonlStore),
        { label: config.jsonlStore.label ?? 'JSONL store', source: 'jsonl-store' }
      );
    case 'redis-stream':
      if (!config.redisStream) {
        throw new Error('Redis stream configuration missing');
      }

      return new PersistentGateway(
        new RedisStreamAdapter(config.redisStream),
        { label: config.redisStream.label ?? 'Redis stream', source: 'redis-stream' }
      );
    case 'temporal-workflow':
      if (!config.temporal) {
        throw new Error('Temporal workflow configuration missing');
      }

      return new PersistentGateway(
        new TemporalWorkflowAdapter(config.temporal),
        { label: config.temporal.label ?? 'Temporal workflow', source: 'temporal-workflow' }
      );
    case 'mock':
    default:
      return new MockGateway();
  }
};
