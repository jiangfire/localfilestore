import { FileServer } from '../src/server';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { Blockchain } from '../src/blockchain';

// 增加超时时间
jest.setTimeout(30000);

describe('FileServer', () => {
  let tempDir: string;
  let server: FileServer;
  let httpPort: number;
  let p2pPort: number;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `server-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // 使用随机端口避免冲突
    httpPort = 10000 + Math.floor(Math.random() * 10000);
    p2pPort = 20000 + Math.floor(Math.random() * 10000);

    server = new FileServer({
      httpPort,
      p2pPort,
      dataDir: tempDir,
    });
  });

  afterEach(async () => {
    if (server) {
      server.stop();
    }
    // 等待端口释放
    await new Promise(resolve => setTimeout(resolve, 100));
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('服务器启动', () => {
    test('应该成功启动服务器', async () => {
      await expect(server.start()).resolves.not.toThrow();
    });

    test('应该创建必要的目录结构', async () => {
      await server.start();

      // 验证 files 目录被创建
      expect(fs.existsSync(path.join(tempDir, 'files'))).toBe(true);
      
      // 执行一些操作来触发 blockchain.json 创建
      // 例如，注册一个文件会保存区块链
      const testFile = path.join(tempDir, 'trigger.txt');
      fs.writeFileSync(testFile, 'content');
      
      // 通过 HTTP API 注册文件
      await new Promise<void>((resolve) => {
        const req = require('http').request(
          {
            hostname: 'localhost',
            port: httpPort,
            path: '/api/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res: any) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          }
        );
        req.write(JSON.stringify({
          filename: 'trigger.txt',
          filepath: testFile,
        }));
        req.end();
      });
      
      // 停止服务器以触发保存
      server.stop();
      
      // 现在应该存在 blockchain.json
      expect(fs.existsSync(path.join(tempDir, 'blockchain.json'))).toBe(true);
    });
  });

  describe('API 端点', () => {
    beforeEach(async () => {
      await server.start();
    });

    const makeRequest = (
      method: string,
      path: string,
      data?: any
    ): Promise<{ statusCode: number; data: any }> => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: httpPort,
          path,
          method,
          headers: data ? { 'Content-Type': 'application/json' } : undefined,
        };

        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve({
                statusCode: res.statusCode || 0,
                data: body ? JSON.parse(body) : {},
              });
            } catch {
              resolve({ statusCode: res.statusCode || 0, data: body });
            }
          });
        });

        req.on('error', reject);

        if (data) {
          req.write(JSON.stringify(data));
        }
        req.end();
      });
    };

    describe('GET /api/files', () => {
      test('应该返回空文件列表', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/files');

        expect(statusCode).toBe(200);
        expect(data.count).toBe(0);
        expect(data.files).toEqual([]);
      });
    });

    describe('GET /api/chain', () => {
      test('应该返回区块链', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/chain');

        expect(statusCode).toBe(200);
        expect(data.length).toBeGreaterThan(0);
        expect(data.chain).toBeDefined();
        expect(data.chain.length).toBeGreaterThan(0);
      });
    });

    describe('GET /api/peers', () => {
      test('应该返回节点信息', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/peers');

        expect(statusCode).toBe(200);
        expect(data.nodeId).toBeDefined();
        expect(data.peerCount).toBe(0);
      });
    });

    describe('POST /api/register', () => {
      test('应该拒绝缺少参数的请求', async () => {
        const { statusCode, data } = await makeRequest('POST', '/api/register', {
          filename: 'test.txt',
          // 缺少 filepath
        });

        expect(statusCode).toBe(400);
        expect(data.error).toBeDefined();
      });

      test('应该拒绝不存在的文件', async () => {
        const { statusCode, data } = await makeRequest('POST', '/api/register', {
          filename: 'test.txt',
          filepath: '/non/existent/file.txt',
        });

        expect(statusCode).toBe(404);
        expect(data.error).toContain('not found');
      });

      test('应该成功注册文件', async () => {
        const testFile = path.join(tempDir, 'test-register.txt');
        fs.writeFileSync(testFile, 'test content for registration');

        const { statusCode, data } = await makeRequest('POST', '/api/register', {
          filename: 'test-register.txt',
          filepath: testFile,
          uploader: 'test-user',
          description: 'Test file',
        });

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.fileId).toBeDefined();
        expect(data.hash).toBeDefined();
      });
    });

    describe('GET /api/files/:id', () => {
      test('应该返回404对于不存在的文件', async () => {
        const { statusCode } = await makeRequest('GET', '/api/files/non-existent');

        expect(statusCode).toBe(404);
      });

      test('应该下载已注册的文件', async () => {
        // 先注册文件
        const testFile = path.join(tempDir, 'test-download.txt');
        const content = 'test content for download';
        fs.writeFileSync(testFile, content);

        const registerRes = await makeRequest('POST', '/api/register', {
          filename: 'test-download.txt',
          filepath: testFile,
        });

        expect(registerRes.data.success).toBe(true);
        const fileId = registerRes.data.fileId;

        // 下载文件
        const { statusCode, data } = await makeRequest('GET', `/api/files/${fileId}`);

        // 由于返回的是文件流，状态码应该是200
        expect(statusCode).toBe(200);
      });
    });

    describe('POST /api/connect', () => {
      test('应该拒绝缺少参数的请求', async () => {
        const { statusCode, data } = await makeRequest('POST', '/api/connect', {
          host: 'localhost',
          // 缺少 port
        });

        expect(statusCode).toBe(400);
        expect(data.error).toBeDefined();
      });
    });

    describe('GET /api/storage/redundancy', () => {
      test('应该返回冗余统计', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/storage/redundancy');

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.stats).toBeDefined();
      });
    });

    describe('GET /api/storage/nodes', () => {
      test('应该返回节点存储信息', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/storage/nodes');

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.localNodeId).toBeDefined();
      });
    });

    describe('GET /api/incentive/account', () => {
      test('应该返回激励账户', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/incentive/account');

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.nodeId).toBeDefined();
        expect(data.balance).toBeDefined();
      });
    });

    describe('GET /api/incentive/stats', () => {
      test('应该返回激励统计', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/incentive/stats');

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.global).toBeDefined();
        expect(data.local).toBeDefined();
      });
    });

    describe('GET /api/incentive/records', () => {
      test('应该返回激励记录', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/incentive/records');

        expect(statusCode).toBe(200);
        expect(data.success).toBe(true);
        expect(data.records).toBeDefined();
      });
    });

    describe('404 处理', () => {
      test('应该返回404对于不存在的端点', async () => {
        const { statusCode, data } = await makeRequest('GET', '/api/non-existent');

        expect(statusCode).toBe(404);
        expect(data.error).toBe('Not found');
      });
    });

    describe('CORS', () => {
      test('应该处理OPTIONS请求', async () => {
        const { statusCode } = await makeRequest('OPTIONS', '/api/files');

        expect(statusCode).toBe(200);
      });
    });
  });

  describe('文件存储', () => {
    beforeEach(async () => {
      await server.start();
    });

    test('注册文件后应该存储在本地', async () => {
      const testFile = path.join(tempDir, 'store-test.txt');
      fs.writeFileSync(testFile, 'content to store');

      const makeRequest = (data: any): Promise<any> => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port: httpPort,
              path: '/api/register',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () => resolve(JSON.parse(body)));
            }
          );
          req.on('error', reject);
          req.write(JSON.stringify(data));
          req.end();
        });
      };

      const result = await makeRequest({
        filename: 'store-test.txt',
        filepath: testFile,
      });

      expect(result.success).toBe(true);

      // 验证文件被复制到存储目录
      const filesDir = path.join(tempDir, 'files');
      const storedFiles = fs.readdirSync(filesDir);
      expect(storedFiles.length).toBeGreaterThan(0);
    });
  });
});
