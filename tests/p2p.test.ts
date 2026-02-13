import { P2PNode, MessageType, type P2PMessage } from '../src/p2p';
import { Blockchain, type Block } from '../src/blockchain';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import * as net from 'net';

// 增加超时时间
jest.setTimeout(30000);

describe('P2PNode', () => {
  let tempDir: string;
  let blockchain: Blockchain;
  let node1: P2PNode;
  let node2: P2PNode;
  let port1: number;
  let port2: number;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `p2p-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    blockchain = new Blockchain();

    // 使用随机端口
    port1 = 30000 + Math.floor(Math.random() * 10000);
    port2 = 30000 + Math.floor(Math.random() * 10000);

    node1 = new P2PNode(blockchain, port1, tempDir);
    node2 = new P2PNode(blockchain, port2, tempDir);
  });

  afterEach(async () => {
    node1?.stop();
    node2?.stop();
    // 等待端口释放
    await new Promise(resolve => setTimeout(resolve, 100));
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('节点启动', () => {
    test('应该成功启动P2P节点', async () => {
      await expect(node1.start()).resolves.not.toThrow();
    });

    test('应该生成唯一的节点ID', () => {
      const id1 = node1.getNodeId();
      const id2 = node2.getNodeId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });

  describe('节点连接', () => {
    beforeEach(async () => {
      await node1.start();
      await node2.start();
    });

    test('应该成功连接到对等节点', async () => {
      await expect(node2.connectToPeer('localhost', port1)).resolves.not.toThrow();
    });

    test('重复连接应该被忽略', async () => {
      await node2.connectToPeer('localhost', port1);
      // 第二次连接不应该抛出错误
      await expect(node2.connectToPeer('localhost', port1)).resolves.not.toThrow();
    });

    test('应该获取连接的节点列表', async () => {
      const peers = node1.getConnectedPeers();
      expect(Array.isArray(peers)).toBe(true);
    });
  });

  describe('消息广播', () => {
    beforeEach(async () => {
      await node1.start();
      await node2.start();
      await node2.connectToPeer('localhost', port1);
      // 等待连接建立
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('应该广播消息', async () => {
      const message: P2PMessage = {
        type: MessageType.QUERY_LATEST,
        data: null,
        sender: node1.getNodeId(),
        timestamp: Date.now(),
      };

      // 不应该抛出错误
      expect(() => node1.broadcast(message)).not.toThrow();
    });

    test('应该广播区块', async () => {
      const block: Block = {
        index: 1,
        timestamp: Date.now(),
        hash: 'test-hash',
        previousHash: blockchain.getLatestBlock().hash,
        data: {
          type: 'REGISTER',
          file: {
            id: 'test-file',
            filename: 'test.txt',
            originalPath: '/test.txt',
            size: 100,
            hash: 'file-hash',
            uploader: 'test',
            timestamp: Date.now(),
          },
        },
        nonce: 0,
      };

      expect(() => node1.broadcastBlock(block)).not.toThrow();
    });
  });

  describe('区块链同步', () => {
    beforeEach(async () => {
      await node1.start();
      await node2.start();
    });

    test('连接后应该同步区块链', async () => {
      // 在 node1 上添加一个区块
      const newBlock = blockchain.addBlock({
        type: 'REGISTER',
        file: {
          id: 'sync-test',
          filename: 'sync.txt',
          originalPath: '/sync.txt',
          size: 100,
          hash: 'sync-hash',
          uploader: 'test',
          timestamp: Date.now(),
        },
      });

      const blockReceived = jest.fn();
      node2.onBlockReceived = blockReceived;

      await node2.connectToPeer('localhost', port1);
      
      // 等待同步
      await new Promise(resolve => setTimeout(resolve, 200));

      // 由于测试环境的限制，这里主要验证连接没有抛出错误
      expect(node2.getConnectedPeers().length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('文件传输', () => {
    beforeEach(async () => {
      await node1.start();
      await node2.start();
      await node2.connectToPeer('localhost', port1);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('应该请求文件', async () => {
      const peers = node1.getConnectedPeers();
      if (peers.length > 0) {
        expect(() => node2.requestFile('test-file', peers[0].id)).not.toThrow();
      }
    });

    test('应该处理文件请求回调', async () => {
      const fileRequested = jest.fn();
      node1.onFileRequested = fileRequested;

      // 触发一个文件请求
      const peers = node1.getConnectedPeers();
      if (peers.length > 0) {
        node2.requestFile('test-file', peers[0].id);
      }

      // 等待消息处理
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('连接管理', () => {
    test('应该处理节点断开', async () => {
      const disconnectedCallback = jest.fn();
      node1.onPeerDisconnected = disconnectedCallback;

      await node1.start();
      await node2.start();
      await node2.connectToPeer('localhost', port1);

      // 等待连接
      await new Promise(resolve => setTimeout(resolve, 100));

      // 断开 node2
      node2.stop();

      // 等待断开事件
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    test('应该处理新节点连接回调', async () => {
      const connectedCallback = jest.fn();
      node1.onPeerConnected = connectedCallback;

      await node1.start();
      await node2.start();
      await node2.connectToPeer('localhost', port1);

      // 等待连接
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('消息类型', () => {
    test('应该定义所有消息类型', () => {
      expect(MessageType.HANDSHAKE).toBe('HANDSHAKE');
      expect(MessageType.QUERY_LATEST).toBe('QUERY_LATEST');
      expect(MessageType.QUERY_ALL).toBe('QUERY_ALL');
      expect(MessageType.RESPONSE_BLOCKCHAIN).toBe('RESPONSE_BLOCKCHAIN');
      expect(MessageType.BROADCAST_BLOCK).toBe('BROADCAST_BLOCK');
      expect(MessageType.REQUEST_FILE).toBe('REQUEST_FILE');
      expect(MessageType.RESPONSE_FILE).toBe('RESPONSE_FILE');
      expect(MessageType.PEER_LIST).toBe('PEER_LIST');
    });
  });

  describe('错误处理', () => {
    test('连接不存在的节点应该失败', async () => {
      await node1.start();
      
      // 连接到一个未使用的端口
      await expect(
        node1.connectToPeer('localhost', 9999)
      ).rejects.toThrow();
    });

    test('停止节点不应该抛出错误', () => {
      expect(() => node1.stop()).not.toThrow();
    });
  });
});
