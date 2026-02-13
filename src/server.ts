import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';
import type { BlockData, FileRecord, Block } from './blockchain';
import { Blockchain } from './blockchain';
import { P2PNode, type PeerInfo, MessageType } from './p2p';
import { StorageManager } from './storage-manager';
import { IncentiveManager, IncentiveType, type IncentiveRecord } from './incentive';

/**
 * 请求体类型
 */
interface RequestBody {
  [key: string]: string | number | undefined;
}

/**
 * 错误对象类型
 */
interface ErrorWithMessage {
  message: string;
}

/**
 * Server配置
 */
interface ServerConfig {
  httpPort: number;
  p2pPort: number;
  dataDir: string;
  seedPeers?: string[]; // 格式: "host:port"
}

/**
 * 区块链文件服务器
 */
export class FileServer {
  private blockchain: Blockchain;
  private p2pNode: P2PNode;
  private storageManager: StorageManager;
  private incentiveManager: IncentiveManager;
  private httpServer: http.Server | null = null;
  private config: ServerConfig;
  private fileStoragePath: string;
  private blockchainPath: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.fileStoragePath = path.join(config.dataDir, 'files');
    this.blockchainPath = path.join(config.dataDir, 'blockchain.json');

    // 确保目录存在
    this.ensureDirectory(config.dataDir);
    this.ensureDirectory(this.fileStoragePath);

    // 加载或创建区块链
    this.blockchain = this.loadBlockchain();

    // 创建P2P节点
    this.p2pNode = new P2PNode(this.blockchain, config.p2pPort, this.fileStoragePath);

    // 创建存储管理器
    this.storageManager = new StorageManager(config.dataDir, this.p2pNode.getNodeId());

    // 创建激励管理器
    this.incentiveManager = new IncentiveManager(config.dataDir, this.p2pNode.getNodeId());

    // 从区块链同步文件列表
    this.storageManager.syncWithBlockchain(this.blockchain.chain);

    // 设置P2P事件处理
    this.setupP2PEvents();
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    // 启动P2P网络
    await this.p2pNode.start();

    // 连接到种子节点
    if (this.config.seedPeers) {
      for (const peer of this.config.seedPeers) {
        const parts = peer.split(':');
        if (parts.length !== 2) continue;
        const [host, portStr] = parts;
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) continue;
        try {
          await this.p2pNode.connectToPeer(host, port);
        } catch {
          console.log(`[Server] Could not connect to seed peer ${peer}`);
        }
      }
    }

    // 启动HTTP服务器
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    const server = this.httpServer;
    return new Promise((resolve, reject) => {
      server.listen(this.config.httpPort, () => {
        console.log(`[Server] HTTP API started on port ${this.config.httpPort}`);
        console.log(`[Server] P2P network on port ${this.config.p2pPort}`);
        console.log(`[Server] Data directory: ${this.config.dataDir}`);
        console.log(`[Server] Blockchain length: ${this.blockchain.length}`);
        resolve();
      });

      server.on('error', reject);
    });
  }

  /**
   * 停止服务器
   */
  stop(): void {
    this.saveBlockchain();
    this.p2pNode.stop();
    this.httpServer?.close();
  }

  /**
   * 设置P2P事件处理
   */
  private setupP2PEvents(): void {
    this.p2pNode.onBlockReceived = (block: Block): void => {
      console.log(`[Server] Received new block #${block.index} from peer`);
      this.saveBlockchain();

      // 同步文件列表到存储管理器
      this.storageManager.syncWithBlockchain(this.blockchain.chain);

      // 发放验证奖励（验证新区块）
      this.incentiveManager.recordValidationReward(this.p2pNode.getNodeId(), block.index);
    };

    this.p2pNode.onFileRequested = (fileId: string, socket: net.Socket): void => {
      const filePath = path.join(this.fileStoragePath, fileId);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        this.p2pNode.sendFile(socket, fileId, data);

        // 发放带宽奖励
        const block = this.blockchain.findFile(fileId);
        if (block) {
          this.incentiveManager.recordBandwidthReward(
            this.p2pNode.getNodeId(),
            fileId,
            data.length,
            block.index
          );
        }
      }
    };

    this.p2pNode.onPeerConnected = (peer: PeerInfo): void => {
      console.log(`[Server] Peer connected: ${peer.id} (${peer.host}:${peer.port})`);
    };

    this.p2pNode.onPeerDisconnected = (peerId: string): void => {
      console.log(`[Server] Peer disconnected: ${peerId}`);
    };
  }

  /**
   * 处理HTTP请求
   */
  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${this.config.httpPort}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/register' && req.method === 'POST') {
        await this.handleRegisterFile(req, res);
      } else if (pathname === '/api/files' && req.method === 'GET') {
        await this.handleListFiles(req, res);
      } else if (pathname.startsWith('/api/files/') && req.method === 'GET') {
        const fileId = pathname.split('/')[3];
        if (fileId) {
          await this.handleGetFile(fileId, req, res);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing file ID' }));
        }
      } else if (pathname === '/api/download' && req.method === 'POST') {
        await this.handleDownloadFromNetwork(req, res);
      } else if (pathname === '/api/peers' && req.method === 'GET') {
        await this.handleListPeers(req, res);
      } else if (pathname === '/api/chain' && req.method === 'GET') {
        await this.handleGetChain(req, res);
      } else if (pathname === '/api/connect' && req.method === 'POST') {
        await this.handleConnectPeer(req, res);
      } else if (pathname === '/api/storage/redundancy' && req.method === 'GET') {
        await this.handleGetRedundancyStats(req, res);
      } else if (pathname.startsWith('/api/storage/file/') && req.method === 'GET') {
        const fileId = pathname.split('/')[4];
        if (fileId) {
          await this.handleGetFileStorage(fileId, req, res);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing file ID' }));
        }
      } else if (pathname === '/api/storage/nodes' && req.method === 'GET') {
        await this.handleGetNodeStorage(req, res);
      } else if (pathname === '/api/incentive/account' && req.method === 'GET') {
        await this.handleGetIncentiveAccount(req, res);
      } else if (pathname === '/api/incentive/records' && req.method === 'GET') {
        await this.handleGetIncentiveRecords(req, res);
      } else if (pathname === '/api/incentive/stats' && req.method === 'GET') {
        await this.handleGetIncentiveStats(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      const error = err as ErrorWithMessage;
      console.error('[Server] Error handling request:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * 处理文件注册
   */
  private async handleRegisterFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.parseBody(req);
    const filename = typeof body.filename === 'string' ? body.filename : '';
    const filepath = typeof body.filepath === 'string' ? body.filepath : '';
    const uploader = typeof body.uploader === 'string' ? body.uploader : undefined;
    const description = typeof body.description === 'string' ? body.description : undefined;

    if (!filename || !filepath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing filename or filepath' }));
      return;
    }

    if (!fs.existsSync(filepath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found at path' }));
      return;
    }

    // 读取文件并计算哈希
    const fileData = fs.readFileSync(filepath);
    const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');
    const fileId = crypto.randomUUID();

    // 存储文件
    const storagePath = path.join(this.fileStoragePath, fileId);
    fs.copyFileSync(filepath, storagePath);

    // 创建文件记录
    const fileRecord: FileRecord = {
      id: fileId,
      filename,
      originalPath: filepath,
      size: fileData.length,
      hash: fileHash,
      uploader: uploader || 'anonymous',
      timestamp: Date.now(),
      description,
    };

    // 添加到区块链
    const blockData: BlockData = {
      type: 'REGISTER',
      file: fileRecord,
    };

    const newBlock = this.blockchain.addBlock(blockData);

    // 广播到P2P网络
    this.p2pNode.broadcastBlock(newBlock);

    // 保存区块链
    this.saveBlockchain();

    // 注册本地存储
    this.storageManager.registerLocalFile(fileRecord);

    // 广播存储信息给对等节点
    this.broadcastStorageInfo(fileId);

    // 发放存储奖励
    this.incentiveManager.recordStorageReward(
      this.p2pNode.getNodeId(),
      fileId,
      fileData.length,
      1, // 至少1天
      newBlock.index
    );

    // 发放验证奖励（挖矿奖励）
    this.incentiveManager.recordValidationReward(this.p2pNode.getNodeId(), newBlock.index);

    console.log(`[Server] Registered file: ${filename} (ID: ${fileId})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        fileId,
        blockIndex: newBlock.index,
        hash: fileHash,
      })
    );
  }

  /**
   * 处理文件列表请求
   */
  private async handleListFiles(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const files = this.blockchain.getAllFiles();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        count: files.length,
        files: files.map(f => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
          hash: f.hash,
          uploader: f.uploader,
          timestamp: f.timestamp,
          description: f.description,
        })),
      })
    );
  }

  /**
   * 处理获取文件请求
   */
  private async handleGetFile(
    fileId: string,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const block = this.blockchain.findFile(fileId);

    if (!block) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found in blockchain' }));
      return;
    }

    const fileRecord = block.data.file;
    const filePath = path.join(this.fileStoragePath, fileId);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File data not found on this node' }));
      return;
    }

    // 返回文件
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileRecord.filename}"`,
      'X-File-Hash': fileRecord.hash,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }

  /**
   * 处理从网络下载文件
   */
  private async handleDownloadFromNetwork(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.parseBody(req);
    const fileId = typeof body.fileId === 'string' ? body.fileId : '';
    const savePath = typeof body.savePath === 'string' ? body.savePath : '';

    if (!fileId || !savePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing fileId or savePath' }));
      return;
    }

    const block = this.blockchain.findFile(fileId);
    if (!block) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found in blockchain' }));
      return;
    }

    const fileRecord = block.data.file;

    // 检查本地是否已有
    const localPath = path.join(this.fileStoragePath, fileId);
    if (fs.existsSync(localPath)) {
      fs.copyFileSync(localPath, savePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, source: 'local' }));
      return;
    }

    // 从P2P网络请求
    const peers = this.p2pNode.getConnectedPeers();
    if (peers.length === 0) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No connected peers to download from' }));
      return;
    }

    // 向所有节点请求文件
    const p2pNode = this.p2pNode;
    try {
      const receivedData = await new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Download timeout')), 30000);

        const onFileReceived = (receivedFileId: string, data: Buffer): void => {
          if (receivedFileId === fileId) {
            clearTimeout(timeout);
            p2pNode.onFileReceived = undefined;
            resolve(data);
          }
        };

        p2pNode.onFileReceived = onFileReceived;

        for (const peer of peers) {
          p2pNode.requestFile(fileId, peer.id);
        }
      });

      // 验证哈希
      const receivedHash = crypto.createHash('sha256').update(receivedData).digest('hex');
      if (receivedHash !== fileRecord.hash) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File hash mismatch' }));
        return;
      }

      // 保存文件
      fs.writeFileSync(savePath, receivedData);
      fs.writeFileSync(localPath, receivedData); // 同时保存到本地存储

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, source: 'network', size: receivedData.length }));
    } catch {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to download from network' }));
    }
  }

  /**
   * 处理节点列表请求
   */
  private async handleListPeers(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const peers = this.p2pNode.getConnectedPeers();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        nodeId: this.p2pNode.getNodeId(),
        peerCount: peers.length,
        peers: peers.map(p => ({
          id: p.id,
          host: p.host,
          port: p.port,
        })),
      })
    );
  }

  /**
   * 处理获取区块链请求
   */
  private async handleGetChain(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        length: this.blockchain.length,
        chain: this.blockchain.chain,
      })
    );
  }

  /**
   * 处理连接新节点请求
   */
  private async handleConnectPeer(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.parseBody(req);
    const host = typeof body.host === 'string' ? body.host : '';
    const port = typeof body.port === 'number' ? body.port : 0;

    if (!host || !port) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing host or port' }));
      return;
    }

    try {
      await this.p2pNode.connectToPeer(host, port);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to connect' }));
    }
  }

  /**
   * 解析请求体
   */
  private parseBody(req: http.IncomingMessage): Promise<RequestBody> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        try {
          const parsed: unknown = body ? JSON.parse(body) : {};
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            resolve(parsed as RequestBody);
          } else {
            resolve({});
          }
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 加载区块链
   */
  private loadBlockchain(): Blockchain {
    if (fs.existsSync(this.blockchainPath)) {
      try {
        const data = fs.readFileSync(this.blockchainPath, 'utf-8');
        const chain = JSON.parse(data) as Block[];
        const blockchain = new Blockchain();
        // 替换链
        if (chain.length > 1) {
          blockchain.replaceChain(chain);
        }
        console.log(`[Server] Loaded blockchain with ${chain.length} blocks`);
        return blockchain;
      } catch (err) {
        const error = err as ErrorWithMessage;
        console.error('[Server] Failed to load blockchain:', error.message);
      }
    }
    return new Blockchain();
  }

  /**
   * 保存区块链
   */
  private saveBlockchain(): void {
    try {
      fs.writeFileSync(this.blockchainPath, JSON.stringify(this.blockchain.chain, null, 2));
    } catch (err) {
      const error = err as ErrorWithMessage;
      console.error('[Server] Failed to save blockchain:', error.message);
    }
  }

  /**
   * 广播存储信息给对等节点
   */
  private broadcastStorageInfo(fileId: string): void {
    const location = this.storageManager.getFileLocation(fileId);
    if (location) {
      this.p2pNode.broadcast({
        type: MessageType.STORAGE_INFO,
        data: {
          nodeId: this.p2pNode.getNodeId(),
          fileId,
          timestamp: Date.now(),
        },
        sender: this.p2pNode.getNodeId(),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 处理获取冗余统计请求
   */
  private async handleGetRedundancyStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const stats = this.storageManager.getRedundancyStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        stats: {
          ...stats,
          atRiskFileCount: stats.atRiskFiles.length,
        },
      })
    );
  }

  /**
   * 处理获取文件存储位置请求
   */
  private async handleGetFileStorage(
    fileId: string,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const location = this.storageManager.getFileLocation(fileId);

    if (!location) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File storage info not found' }));
      return;
    }

    // 获取节点详细信息
    const nodes = location.storedOn.map(nodeId => {
      const info = this.storageManager.getNodeStorage(nodeId);
      return {
        nodeId,
        host: info?.host || 'unknown',
        port: info?.port || 0,
        lastSeen: info?.lastSeen,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        file: {
          fileId: location.fileId,
          filename: location.filename,
          size: location.size,
          hash: location.hash,
          redundancy: location.redundancy,
          storedOnNodes: nodes,
        },
      })
    );
  }

  /**
   * 处理获取节点存储信息请求
   */
  private async handleGetNodeStorage(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const nodes = this.storageManager.getAllNodeStorage();
    const localFiles = this.blockchain.getAllFiles();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        localNodeId: this.p2pNode.getNodeId(),
        localFileCount: localFiles.length,
        localStorageSize: nodes.find(n => n.nodeId === this.p2pNode.getNodeId())?.totalSize || 0,
        nodes: nodes.map(n => ({
          nodeId: n.nodeId,
          host: n.host,
          port: n.port,
          fileCount: n.fileIds.length,
          totalSize: n.totalSize,
          lastSeen: n.lastSeen,
        })),
      })
    );
  }

  /**
   * 处理获取激励账户请求
   */
  private async handleGetIncentiveAccount(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.httpPort}`);
    const nodeId = url.searchParams.get('nodeId') || this.p2pNode.getNodeId();

    const stats = this.incentiveManager.getNodeRewardStats(nodeId);
    const account = this.incentiveManager.getAccount(nodeId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        nodeId,
        balance: stats.currentBalance,
        totalEarned: stats.totalEarned,
        totalWithdrawn: account?.totalWithdrawn || 0,
        rewardsByType: stats.byType,
      })
    );
  }

  /**
   * 处理获取激励记录请求
   */
  private async handleGetIncentiveRecords(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.config.httpPort}`);
    const nodeId = url.searchParams.get('nodeId');
    const type = url.searchParams.get('type') as IncentiveType | null;

    let records: IncentiveRecord[];

    if (nodeId) {
      records = this.incentiveManager.getRecordsByNode(nodeId);
    } else if (type) {
      records = this.incentiveManager.getRecordsByType(type);
    } else {
      // 返回本地节点的记录
      records = this.incentiveManager.getRecordsByNode(this.p2pNode.getNodeId());
    }

    // 按时间倒序
    records = records.sort((a, b) => b.timestamp - a.timestamp);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        count: records.length,
        records: records.map(r => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          timestamp: r.timestamp,
          blockIndex: r.blockIndex,
          description: r.description,
          fileId: r.fileId,
        })),
      })
    );
  }

  /**
   * 处理获取激励统计请求
   */
  private async handleGetIncentiveStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const globalStats = this.incentiveManager.getGlobalStats();
    const localStats = this.incentiveManager.getNodeRewardStats(this.p2pNode.getNodeId());

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        global: globalStats,
        local: {
          nodeId: this.p2pNode.getNodeId(),
          ...localStats,
        },
        config: {
          storageRewardPerMB: this.incentiveManager['config'].storageRewardPerMB,
          downloadRewardPerMB: this.incentiveManager['config'].downloadRewardPerMB,
          uptimeRewardPerHour: this.incentiveManager['config'].uptimeRewardPerHour,
          validationReward: this.incentiveManager['config'].validationReward,
        },
      })
    );
  }
}
