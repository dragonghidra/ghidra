import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcpServers } from '../src/mcp/config.js';

test('loadMcpServers discovers workspace .mcp.json definitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  try {
    const configPath = join(root, '.mcp.json');
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '${WORKSPACE_ROOT}'],
            env: {
              TOKEN: '${CUSTOM_TOKEN}',
            },
            description: 'Workspace FS',
          },
        },
        null,
        2
      )
    );

    const servers = await loadMcpServers({
      workingDir: root,
      env: { CUSTOM_TOKEN: 'abc123' },
    });

    assert.equal(servers.length, 1);
    const server = servers[0];
    assert.ok(server);
    assert.equal(server.id, 'filesystem');
    assert.equal(server.command, 'npx');
    assert.deepEqual(server.args, ['-y', '@modelcontextprotocol/server-filesystem', root]);
    assert.equal(server.env['TOKEN'], 'abc123');
    assert.equal(server.description, 'Workspace FS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
