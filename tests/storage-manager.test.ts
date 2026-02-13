import { StorageManager } from '../src/storage-manager';
import type { FileRecord } from '../src/blockchain';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import type { Block } from '../src/blockchain';

describe('StorageManager', () => {
  let tempDir: string;
  let manager: StorageManager;
  const nodeId = 'test-node-123';
  const otherNodeId = 'test-node-456';

  // 模拟文件记录
  const mockFile: FileRecord = {
    id: 'file-123',
    filename: 'test.txt',
    originalPath: '/path/to/test.txt',
    size: 1024,
    hash: 'abc123hash',
    uploader: 'test-user',
    timestamp: Date.now(),
    description: 'test file',
  };

  const mockFile2: FileRecord = {
    id: 'file-456',
    filename: 'test2.txt',
    originalPath: '/path/to/test2.txt',
    size: 2048,
    hash: 'def456hash',
    uploader: 'test-user',
    timestamp: Date.now(),
  };

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `storage-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    manager = new StorageManager(tempDir, nodeId);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('本地文件注册', () => {
    test('应该注册本地文件', () => {
      manager.registerLocalFile(mockFile);

      const location = manager.getFileLocation(mockFile.id);
      expect(location).toBeDefined();
      expect(location?.filename).toBe(mockFile.filename);
      expect(location?.redundancy).toBe(1);
      expect(location?.storedOn).toContain(nodeId);
    });

    test('重复注册不应该重复计数', () => {
      manager.registerLocalFile(mockFile);
      manager.registerLocalFile(mockFile);

      const location = manager.getFileLocation(mockFile.id);
      expect(location?.redundancy).toBe(1);

      const nodeInfo = manager.getNodeStorage(nodeId);
      expect(nodeInfo?.fileIds.length).toBe(1);
    });

    test('应该更新节点存储大小', () => {
      manager.registerLocalFile(mockFile);

      const nodeInfo = manager.getNodeStorage(nodeId);
      expect(nodeInfo?.totalSize).toBe(mockFile.size);
    });

    test('多个文件应该正确累计', () => {
      manager.registerLocalFile(mockFile);
      manager.registerLocalFile(mockFile2);

      const nodeInfo = manager.getNodeStorage(nodeId);
      expect(nodeInfo?.fileIds.length).toBe(2);
      expect(nodeInfo?.totalSize).toBe(mockFile.size + mockFile2.size);
    });
  });

  describe('远程文件注册', () => {
    test('应该注册远程节点文件', () => {
      manager.registerRemoteFile(otherNodeId, mockFile.id, mockFile);

      const location = manager.getFileLocation(mockFile.id);
      expect(location).toBeDefined();
      expect(location?.storedOn).toContain(otherNodeId);
      expect(location?.redundancy).toBe(1);
    });

    test('同一文件多个节点应该增加冗余度', () => {
      manager.registerRemoteFile(otherNodeId, mockFile.id, mockFile);
      manager.registerRemoteFile(nodeId, mockFile.id, mockFile);

      const location = manager.getFileLocation(mockFile.id);
      expect(location?.redundancy).toBe(2);
      expect(location?.storedOn).toContain(nodeId);
      expect(location?.storedOn).toContain(otherNodeId);
    });
  });

  describe('节点信息管理', () => {
    test('应该更新节点信息', () => {
      manager.updateNodeInfo(otherNodeId, '192.168.1.100', 6000);

      const info = manager.getNodeStorage(otherNodeId);
      expect(info).toBeDefined();
      expect(info?.host).toBe('192.168.1.100');
      expect(info?.port).toBe(6000);
    });

    test('应该获取所有节点存储信息', () => {
      manager.registerLocalFile(mockFile);
      manager.updateNodeInfo(otherNodeId, '192.168.1.100', 6000);

      const allNodes = manager.getAllNodeStorage();
      expect(allNodes.length).toBe(2);
    });
  });

  describe('文件位置查询', () => {
    beforeEach(() => {
      manager.registerLocalFile(mockFile);
      manager.registerRemoteFile(otherNodeId, mockFile.id, mockFile);
    });

    test('应该获取文件存储位置', () => {
      const location = manager.getFileLocation(mockFile.id);
      expect(location).toBeDefined();
      expect(location?.fileId).toBe(mockFile.id);
    });

    test('应该获取存储文件的节点', () => {
      const nodes = manager.getNodesStoringFile(mockFile.id);
      expect(nodes.length).toBe(2);
      expect(nodes).toContain(nodeId);
      expect(nodes).toContain(otherNodeId);
    });

    test('应该获取所有文件位置', () => {
      const locations = manager.getAllFileLocations();
      expect(locations.length).toBe(1);
    });

    test('不存在的文件应该返回undefined', () => {
      const location = manager.getFileLocation('non-existent');
      expect(location).toBeUndefined();
    });
  });

  describe('冗余统计', () => {
    test('应该计算冗余统计', () => {
      manager.registerLocalFile(mockFile);
      manager.registerRemoteFile(otherNodeId, mockFile.id, mockFile);
      manager.registerLocalFile(mockFile2);

      const stats = manager.getRedundancyStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalUniqueSize).toBe(mockFile.size + mockFile2.size);
      expect(stats.averageRedundancy).toBeGreaterThan(1);
      expect(stats.maxRedundancy).toBe(2);
    });

    test('应该识别风险文件（单副本）', () => {
      manager.registerLocalFile(mockFile); // 只有一个副本
      manager.registerRemoteFile(otherNodeId, 'file-safe', { size: 100 } as FileRecord);
      manager.registerRemoteFile(nodeId, 'file-safe', { size: 100 } as FileRecord);

      const stats = manager.getRedundancyStats();
      expect(stats.atRiskFiles).toContain(mockFile.id);
      expect(stats.atRiskFiles).not.toContain('file-safe');
    });

    test('空存储应该返回0统计', () => {
      const stats = manager.getRedundancyStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.averageRedundancy).toBe(0);
    });
  });

  describe('冗余度检查', () => {
    test('应该检查文件冗余度是否足够', () => {
      manager.registerLocalFile(mockFile);

      expect(manager.hasEnoughRedundancy(mockFile.id, 1)).toBe(true);
      expect(manager.hasEnoughRedundancy(mockFile.id, 2)).toBe(false);

      manager.registerRemoteFile(otherNodeId, mockFile.id, mockFile);
      expect(manager.hasEnoughRedundancy(mockFile.id, 2)).toBe(true);
    });

    test('不存在的文件应该返回false', () => {
      expect(manager.hasEnoughRedundancy('non-existent', 1)).toBe(false);
    });
  });

  describe('欠复制文件查询', () => {
    test('应该获取欠复制文件', () => {
      manager.registerLocalFile(mockFile); // 1副本
      manager.registerRemoteFile(otherNodeId, 'file-2', { size: 100 } as FileRecord);
      manager.registerRemoteFile(nodeId, 'file-2', { size: 100 } as FileRecord);
      manager.registerRemoteFile('node-3', 'file-2', { size: 100 } as FileRecord);

      const underReplicated = manager.getUnderReplicatedFiles(3);

      expect(underReplicated.some(f => f.fileId === mockFile.id)).toBe(true);
      expect(underReplicated.some(f => f.fileId === 'file-2')).toBe(false);
    });
  });

  describe('区块链同步', () => {
    test('应该从区块链同步文件列表', () => {
      const chain: Block[] = [
        {
          index: 0,
          timestamp: Date.now(),
          hash: 'genesis-hash',
          previousHash: '0',
          nonce: 0,
          data: {
            type: 'REGISTER',
            file: {
              id: 'genesis',
              filename: 'genesis',
              originalPath: '',
              size: 0,
              hash: '0',
              uploader: 'system',
              timestamp: Date.now(),
            },
          },
        },
        {
          index: 1,
          timestamp: Date.now(),
          hash: 'block1-hash',
          previousHash: 'genesis-hash',
          nonce: 0,
          data: {
            type: 'REGISTER',
            file: mockFile,
          },
        },
        {
          index: 2,
          timestamp: Date.now(),
          hash: 'block2-hash',
          previousHash: 'block1-hash',
          nonce: 0,
          data: {
            type: 'REGISTER',
            file: mockFile2,
          },
        },
      ];

      manager.syncWithBlockchain(chain);

      expect(manager.getFileLocation(mockFile.id)).toBeDefined();
      expect(manager.getFileLocation(mockFile2.id)).toBeDefined();
      // 注意：syncWithBlockchain 会跳过 id 为 'genesis' 的文件
      expect(manager.getFileLocation('genesis')).toBeUndefined();
    });
  });

  describe('清理失效节点', () => {
    test('应该清理长时间未活跃的节点', () => {
      // 注册旧节点
      manager.updateNodeInfo('old-node', '192.168.1.1', 6000);
      manager.registerRemoteFile('old-node', 'file-1', { size: 100 } as FileRecord);

      // 手动修改lastSeen为很久以前
      const storagePath = path.join(tempDir, 'storage-index.json');
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      const oldNodeEntry = data.nodes.find((n: [string, any]) => n[0] === 'old-node');
      if (oldNodeEntry) {
        oldNodeEntry[1].lastSeen = Date.now() - 25 * 60 * 60 * 1000; // 25小时前
      }
      fs.writeFileSync(storagePath, JSON.stringify(data));

      // 重新加载管理器
      const newManager = new StorageManager(tempDir, nodeId);
      const removed = newManager.cleanupStaleNodes(24 * 60 * 60 * 1000);

      expect(removed).toContain('old-node');
      expect(newManager.getNodeStorage('old-node')).toBeUndefined();
    });

    test('不应该清理本地节点', () => {
      // 尝试清理本地节点（通过修改lastSeen）
      const storagePath = path.join(tempDir, 'storage-index.json');
      manager.registerLocalFile(mockFile);

      const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      const localEntry = data.nodes.find((n: [string, any]) => n[0] === nodeId);
      if (localEntry) {
        localEntry[1].lastSeen = Date.now() - 25 * 60 * 60 * 1000;
      }
      fs.writeFileSync(storagePath, JSON.stringify(data));

      const newManager = new StorageManager(tempDir, nodeId);
      const removed = newManager.cleanupStaleNodes(24 * 60 * 60 * 1000);

      expect(removed).not.toContain(nodeId);
    });
  });

  describe('持久化', () => {
    test('数据应该持久化到文件', () => {
      manager.registerLocalFile(mockFile);

      // 创建新实例
      const newManager = new StorageManager(tempDir, nodeId);
      const location = newManager.getFileLocation(mockFile.id);

      expect(location).toBeDefined();
      expect(location?.filename).toBe(mockFile.filename);
    });
  });
});
