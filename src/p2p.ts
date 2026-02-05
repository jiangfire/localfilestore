import * as net from 'net';
import * as crypto from 'crypto';
import type { Block } from './blockchain';
import { Blockchain } from './blockchain';

/**
 * P2P消息类型
 */
export enum MessageType {
  HANDSHAKE = 'HANDSHAKE',
  QUERY_LATEST = 'QUERY_LATEST',
  QUERY_ALL = 'QUERY_ALL',
  RESPONSE_BLOCKCHAIN = 'RESPONSE_BLOCKCHAIN',
  BROADCAST_BLOCK = 'BROADCAST_BLOCK',
  REQUEST_FILE = 'REQUEST_FILE',
  RESPONSE_FILE = 'RESPONSE_FILE',
  PEER_LIST = 'PEER_LIST',
}

/**
 * P2P消息数据结构
 */
export interface HandshakeData {
  port: number;
  nodeId: string;
}

export interface RequestFileData {
  fileId: string;
}

export interface ResponseFileData {
  fileId: string;
  chunk: string;
  isLast: boolean;
}

export type P2PMessageData =
  | HandshakeData
  | Block[]
  | Block
  | RequestFileData
  | ResponseFileData
  | null;

/**
 * P2P消息结构
 */
export interface P2PMessage {
  type: MessageType;
  data: P2PMessageData;
  sender: string; // 发送者ID
  timestamp: number;
}

/**
 * 节点信息
 */
export interface PeerInfo {
  host: string;
  port: number;
  id: string;
  lastSeen: number;
}

/**
 * 文件传输会话
 */
interface FileTransferSession {
  fileId: string;
  chunks: Buffer[];
  totalSize: number;
  receivedSize: number;
}

/**
 * 验证消息是否为有效的 P2PMessage
 */
function isValidP2PMessage(message: unknown): message is P2PMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const msg = message as Record<string, unknown>;
  return (
    typeof msg.type === 'string' &&
    typeof msg.sender === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

/**
 * P2P网络节点
 */
export class P2PNode {
  private server: net.Server | null = null;
  private peers: Map<string, net.Socket> = new Map();
  private peerInfo: Map<string, PeerInfo> = new Map();
  private nodeId: string;
  private port: number;
  private blockchain: Blockchain;
  private fileStoragePath: string;
  private fileTransfers: Map<string, FileTransferSession> = new Map();

  // 事件回调
  public onBlockReceived?: (block: Block) => void;
  public onFileRequested?: (fileId: string, socket: net.Socket) => void;
  public onFileReceived?: (fileId: string, data: Buffer) => void;
  public onPeerConnected?: (peer: PeerInfo) => void;
  public onPeerDisconnected?: (peerId: string) => void;

  constructor(blockchain: Blockchain, port: number, fileStoragePath: string) {
    this.nodeId = crypto.randomUUID();
    this.port = port;
    this.blockchain = blockchain;
    this.fileStoragePath = fileStoragePath;
  }

  /**
   * 获取节点ID
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * 启动P2P服务
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer(socket => {
        this.handleConnection(socket);
      });

      this.server.listen(this.port, () => {
        console.log(`[P2P] Server started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', err => {
        reject(err);
      });
    });
  }

  /**
   * 停止P2P服务
   */
  stop(): void {
    this.peers.forEach(socket => socket.destroy());
    this.peers.clear();
    this.server?.close();
  }

  /**
   * 连接到对等节点
   */
  async connectToPeer(host: string, port: number): Promise<void> {
    const peerKey = `${host}:${port}`;

    if (this.peers.has(peerKey)) {
      console.log(`[P2P] Already connected to ${peerKey}`);
      return;
    }

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();

      socket.connect(port, host, () => {
        console.log(`[P2P] Connected to peer ${host}:${port}`);
        this.handleConnection(socket, host, port);
        resolve();
      });

      socket.on('error', (err: Error) => {
        console.error(`[P2P] Failed to connect to ${host}:${port}:`, err.message);
        reject(err);
      });
    });
  }

  /**
   * 处理连接
   */
  private handleConnection(socket: net.Socket, _host?: string, _port?: number): void {
    let buffer = '';
    let peerId: string | null = null;

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();

      // 处理消息（以换行符分隔的JSON）
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的部分

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed: unknown = JSON.parse(line);
            if (isValidP2PMessage(parsed)) {
              const message: P2PMessage = parsed;
              this.handleMessage(message, socket, id => {
                if (!peerId) {
                  peerId = id;
                  this.peers.set(id, socket);
                }
              });
            } else {
              console.error('[P2P] Invalid message format');
            }
          } catch {
            console.error('[P2P] Failed to parse message');
          }
        }
      }
    });

    socket.on('close', () => {
      if (peerId) {
        this.peers.delete(peerId);
        this.peerInfo.delete(peerId);
        this.onPeerDisconnected?.(peerId);
      }
    });

    socket.on('error', (err: Error) => {
      console.error('[P2P] Socket error:', err.message);
    });

    // 发送握手消息
    this.sendMessage(socket, {
      type: MessageType.HANDSHAKE,
      data: { port: this.port, nodeId: this.nodeId },
      sender: this.nodeId,
      timestamp: Date.now(),
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(
    message: P2PMessage,
    socket: net.Socket,
    setPeerId: (id: string) => void
  ): void {
    switch (message.type) {
      case MessageType.HANDSHAKE: {
        const peerData = message.data as HandshakeData;
        const peerId = message.sender;
        setPeerId(peerId);

        this.peerInfo.set(peerId, {
          host: socket.remoteAddress || 'unknown',
          port: peerData.port,
          id: peerId,
          lastSeen: Date.now(),
        });

        const peerInfo = this.peerInfo.get(peerId);
        if (peerInfo) {
          this.onPeerConnected?.(peerInfo);
        }

        // 请求最新的区块链
        this.sendMessage(socket, {
          type: MessageType.QUERY_ALL,
          data: null,
          sender: this.nodeId,
          timestamp: Date.now(),
        });
        break;
      }

      case MessageType.QUERY_LATEST:
        this.sendMessage(socket, {
          type: MessageType.RESPONSE_BLOCKCHAIN,
          data: [this.blockchain.getLatestBlock()],
          sender: this.nodeId,
          timestamp: Date.now(),
        });
        break;

      case MessageType.QUERY_ALL:
        this.sendMessage(socket, {
          type: MessageType.RESPONSE_BLOCKCHAIN,
          data: this.blockchain.chain,
          sender: this.nodeId,
          timestamp: Date.now(),
        });
        break;

      case MessageType.RESPONSE_BLOCKCHAIN:
        this.handleBlockchainResponse(message.data as Block[]);
        break;

      case MessageType.BROADCAST_BLOCK: {
        const newBlock = message.data as Block;
        const latest = this.blockchain.getLatestBlock();

        if (newBlock.previousHash === latest.hash && newBlock.index === latest.index + 1) {
          // 验证并添加区块
          const addedBlock = this.blockchain.addBlock(newBlock.data);
          this.onBlockReceived?.(addedBlock);
          this.broadcast(
            {
              type: MessageType.BROADCAST_BLOCK,
              data: newBlock,
              sender: this.nodeId,
              timestamp: Date.now(),
            },
            message.sender
          );
        } else if (newBlock.index > latest.index) {
          // 我们的链可能落后了，请求完整链
          this.sendMessage(socket, {
            type: MessageType.QUERY_ALL,
            data: null,
            sender: this.nodeId,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case MessageType.REQUEST_FILE:
        this.onFileRequested?.((message.data as RequestFileData).fileId, socket);
        break;

      case MessageType.RESPONSE_FILE:
        this.handleFileResponse(message.data as ResponseFileData);
        break;
    }
  }

  /**
   * 处理区块链响应
   */
  private handleBlockchainResponse(receivedChain: Block[]): void {
    if (receivedChain.length === 0) return;

    const latestReceived = receivedChain[receivedChain.length - 1];
    const latestLocal = this.blockchain.getLatestBlock();

    if (latestReceived.index > latestLocal.index) {
      if (latestLocal.hash === latestReceived.previousHash) {
        // 我们可以添加这个区块
        console.log('[P2P] Appending received block to chain');
        this.blockchain.addBlock(latestReceived.data);
        this.onBlockReceived?.(latestReceived);
      } else if (receivedChain.length === 1) {
        // 我们需要查询整个链
        console.log('[P2P] Querying full chain from peers');
        this.broadcast({
          type: MessageType.QUERY_ALL,
          data: null,
          sender: this.nodeId,
          timestamp: Date.now(),
        });
      } else {
        // 尝试替换链
        console.log('[P2P] Replacing chain with longer valid chain');
        if (this.blockchain.replaceChain(receivedChain)) {
          console.log('[P2P] Chain replaced successfully');
        }
      }
    }
  }

  /**
   * 处理文件响应
   */
  private handleFileResponse(data: ResponseFileData): void {
    const chunk = Buffer.from(data.chunk, 'base64');

    let session = this.fileTransfers.get(data.fileId);
    if (!session) {
      session = {
        fileId: data.fileId,
        chunks: [],
        totalSize: 0,
        receivedSize: 0,
      };
      this.fileTransfers.set(data.fileId, session);
    }

    session.chunks.push(chunk);
    session.receivedSize += chunk.length;

    if (data.isLast) {
      const fullData = Buffer.concat(session.chunks);
      this.fileTransfers.delete(data.fileId);
      this.onFileReceived?.(data.fileId, fullData);
    }
  }

  /**
   * 发送消息
   */
  private sendMessage(socket: net.Socket, message: P2PMessage): void {
    socket.write(JSON.stringify(message) + '\n');
  }

  /**
   * 广播消息到所有对等节点
   */
  broadcast(message: P2PMessage, excludePeerId?: string): void {
    this.peers.forEach((socket, peerId) => {
      if (peerId !== excludePeerId) {
        this.sendMessage(socket, message);
      }
    });
  }

  /**
   * 广播新区块
   */
  broadcastBlock(block: Block): void {
    this.broadcast({
      type: MessageType.BROADCAST_BLOCK,
      data: block,
      sender: this.nodeId,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取所有连接的节点
   */
  getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peerInfo.values());
  }

  /**
   * 发送文件给请求者
   */
  sendFile(socket: net.Socket, fileId: string, data: Buffer): void {
    const chunkSize = 64 * 1024; // 64KB chunks

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const isLast = i + chunkSize >= data.length;

      this.sendMessage(socket, {
        type: MessageType.RESPONSE_FILE,
        data: {
          fileId,
          chunk: chunk.toString('base64'),
          isLast,
        },
        sender: this.nodeId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 请求文件
   */
  requestFile(fileId: string, peerId: string): void {
    const socket = this.peers.get(peerId);
    if (socket) {
      this.sendMessage(socket, {
        type: MessageType.REQUEST_FILE,
        data: { fileId },
        sender: this.nodeId,
        timestamp: Date.now(),
      });
    }
  }
}
