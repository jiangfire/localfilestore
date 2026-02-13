/**
 * Client-Server 集成测试
 * 同时启动服务器和客户端进行真实测试
 */
import { FileServer } from '../src/server';
import { FileClient } from '../src/client';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

jest.setTimeout(60000);

describe('Client-Server Integration', () => {
  let tempDir: string;
  let server: FileServer;
  let client: FileClient;
  let httpPort: number;
  let p2pPort: number;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `integration-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    httpPort = 30000 + Math.floor(Math.random() * 5000);
    p2pPort = 35000 + Math.floor(Math.random() * 5000);

    server = new FileServer({
      httpPort,
      p2pPort,
      dataDir: tempDir,
    });

    client = new FileClient({
      serverHost: 'localhost',
      serverPort: httpPort,
      downloadDir: path.join(tempDir, 'downloads'),
    });

    await server.start();
  });

  afterEach(async () => {
    server?.stop();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('完整文件流程', () => {
    test('应该注册并列出文件', async () => {
      // 创建测试文件
      const testFile = path.join(tempDir, 'integration-test.txt');
      fs.writeFileSync(testFile, 'Hello, Integration Test!');

      // 注册文件
      const registerResult = await client.registerFile(
        testFile,
        'integration-tester',
        'Test file for integration'
      );

      expect(registerResult.success).toBe(true);
      expect(registerResult.fileId).toBeDefined();

      // 列出文件
      const listResult = await client.listFiles();
      expect(listResult.success).toBe(true);
      expect(listResult.files?.length).toBeGreaterThan(0);
      
      const uploadedFile = listResult.files?.find(f => f.id === registerResult.fileId);
      expect(uploadedFile).toBeDefined();
      expect(uploadedFile?.filename).toBe('integration-test.txt');
      expect(uploadedFile?.uploader).toBe('integration-tester');
    });

    test('应该注册并下载文件', async () => {
      // 创建测试文件
      const testFile = path.join(tempDir, 'download-test.txt');
      const content = 'Test content for download';
      fs.writeFileSync(testFile, content);

      // 注册文件
      const registerResult = await client.registerFile(testFile);
      expect(registerResult.success).toBe(true);

      // 下载文件
      const downloadPath = path.join(tempDir, 'downloads', 'downloaded.txt');
      const downloadResult = await client.downloadFile(
        registerResult.fileId!,
        downloadPath
      );

      expect(downloadResult.success).toBe(true);
      expect(fs.existsSync(downloadPath)).toBe(true);
      expect(fs.readFileSync(downloadPath, 'utf-8')).toBe(content);
    });

    test('应该验证正确的文件哈希', async () => {
      const testFile = path.join(tempDir, 'verify-test.txt');
      fs.writeFileSync(testFile, 'Content to verify');

      const registerResult = await client.registerFile(testFile);
      expect(registerResult.success).toBe(true);

      const verifyResult = await client.verifyFile(
        registerResult.fileId!,
        testFile
      );

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.valid).toBe(true);
    });

    test('应该检测到错误的文件哈希', async () => {
      const testFile = path.join(tempDir, 'original.txt');
      const wrongFile = path.join(tempDir, 'wrong.txt');
      fs.writeFileSync(testFile, 'Original content');
      fs.writeFileSync(wrongFile, 'Different content');

      const registerResult = await client.registerFile(testFile);
      expect(registerResult.success).toBe(true);

      const verifyResult = await client.verifyFile(
        registerResult.fileId!,
        wrongFile
      );

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.valid).toBe(false);
    });
  });

  describe('区块链查询', () => {
    test('应该获取区块链信息', async () => {
      const chainResult = await client.viewChain();
      expect(chainResult.success).toBe(true);
      expect(chainResult.chain).toBeDefined();
      expect(chainResult.chain?.length).toBeGreaterThanOrEqual(1);
    });

    test('注册文件后区块链应该增长', async () => {
      const beforeResult = await client.viewChain();
      const beforeLength = beforeResult.chain?.length || 0;

      // 注册文件
      const testFile = path.join(tempDir, 'chain-test.txt');
      fs.writeFileSync(testFile, 'test');
      await client.registerFile(testFile);

      const afterResult = await client.viewChain();
      const afterLength = afterResult.chain?.length || 0;

      expect(afterLength).toBe(beforeLength + 1);
    });
  });

  describe('节点查询', () => {
    test('应该获取节点信息', async () => {
      const peersResult = await client.viewPeers();
      expect(peersResult.success).toBe(true);
      expect(peersResult.nodeId).toBeDefined();
    });
  });

  describe('激励查询', () => {
    test('应该获取激励账户', async () => {
      const accountResult = await client.viewIncentiveAccount();
      expect(accountResult.success).toBe(true);
      expect(accountResult.data?.nodeId).toBeDefined();
    });

    test('注册文件后应该有激励记录', async () => {
      const testFile = path.join(tempDir, 'incentive-test.txt');
      fs.writeFileSync(testFile, 'test content');
      await client.registerFile(testFile);

      const recordsResult = await client.viewIncentiveRecords();
      expect(recordsResult.success).toBe(true);
      expect(recordsResult.records?.length).toBeGreaterThan(0);
    });

    test('应该获取激励统计', async () => {
      const statsResult = await client.viewIncentiveStats();
      expect(statsResult.success).toBe(true);
      expect(statsResult.data?.global).toBeDefined();
      expect(statsResult.data?.local).toBeDefined();
    });
  });

  describe('存储冗余查询', () => {
    test('应该获取冗余统计', async () => {
      const testFile = path.join(tempDir, 'redundancy-test.txt');
      fs.writeFileSync(testFile, 'test');
      await client.registerFile(testFile);

      // 通过 HTTP 直接请求 API
      const http = require('http');
      const redundancyResult = await new Promise<any>((resolve, reject) => {
        http.get(`http://localhost:${httpPort}/api/storage/redundancy`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });

      expect(redundancyResult.success).toBe(true);
      expect(redundancyResult.stats).toBeDefined();
    });
  });

  describe('格式化输出', () => {
    test('showFileList 应该正常执行', async () => {
      const testFile = path.join(tempDir, 'show-test.txt');
      fs.writeFileSync(testFile, 'test');
      await client.registerFile(testFile);

      await expect(client.showFileList()).resolves.not.toThrow();
    });

    test('showChain 应该正常执行', async () => {
      await expect(client.showChain()).resolves.not.toThrow();
    });

    test('showPeers 应该正常执行', async () => {
      await expect(client.showPeers()).resolves.not.toThrow();
    });

    test('showIncentiveAccount 应该正常执行', async () => {
      await expect(client.showIncentiveAccount()).resolves.not.toThrow();
    });

    test('showIncentiveRecords 应该正常执行', async () => {
      await expect(client.showIncentiveRecords()).resolves.not.toThrow();
    });

    test('showIncentiveStats 应该正常执行', async () => {
      await expect(client.showIncentiveStats()).resolves.not.toThrow();
    });
  });

  describe('错误处理', () => {
    test('下载不存在的文件应该失败', async () => {
      const result = await client.downloadFile('non-existent-id');
      expect(result.success).toBe(false);
    });

    test('验证不存在的文件应该失败', async () => {
      const result = await client.verifyFile('non-existent', '/tmp/fake.txt');
      expect(result.success).toBe(false);
    });

    test('连接不存在的节点应该失败', async () => {
      const result = await client.connectPeer('localhost', 9999);
      expect(result.success).toBe(false);
    });
  });
});
