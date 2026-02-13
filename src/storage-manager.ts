import * as fs from 'fs';
import * as path from 'path';
import type { Block, FileRecord } from './blockchain';

/**
 * 节点存储信息
 */
export interface NodeStorageInfo {
  nodeId: string;
  host: string;
  port: number;
  fileIds: string[]; // 该节点存储的文件ID列表
  totalSize: number; // 总存储大小
  lastSeen: number; // 最后活跃时间
}

/**
 * 文件存储位置信息
 */
export interface FileStorageLocation {
  fileId: string;
  filename: string;
  size: number;
  hash: string;
  storedOn: string[]; // 存储该文件的节点ID列表
  redundancy: number; // 冗余度（副本数）
}

/**
 * 存储冗余统计
 */
export interface RedundancyStats {
  totalFiles: number;
  totalUniqueSize: number;
  totalReplicatedSize: number;
  averageRedundancy: number;
  minRedundancy: number;
  maxRedundancy: number;
  atRiskFiles: string[]; // 冗余度为1的文件（只有一个副本）
}

/**
 * 存储管理器 - 跟踪文件在节点间的分布
 */
export class StorageManager {
  private storagePath: string;
  private nodeStorageMap: Map<string, NodeStorageInfo> = new Map();
  private fileLocationMap: Map<string, FileStorageLocation> = new Map();
  private localNodeId: string;

  constructor(dataDir: string, nodeId: string) {
    this.storagePath = path.join(dataDir, 'storage-index.json');
    this.localNodeId = nodeId;
    this.loadIndex();
  }

  /**
   * 加载存储索引
   */
  private loadIndex(): void {
    if (fs.existsSync(this.storagePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8')) as {
          nodes?: [string, NodeStorageInfo][];
          files?: [string, FileStorageLocation][];
        };
        this.nodeStorageMap = new Map(data.nodes || []);
        this.fileLocationMap = new Map(data.files || []);
      } catch {
        console.log('[Storage] Failed to load storage index, starting fresh');
      }
    }
  }

  /**
   * 保存存储索引
   */
  private saveIndex(): void {
    try {
      const data = {
        nodes: Array.from(this.nodeStorageMap.entries()),
        files: Array.from(this.fileLocationMap.entries()),
        timestamp: Date.now(),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Storage] Failed to save storage index:', err);
    }
  }

  /**
   * 注册本地存储的文件
   */
  registerLocalFile(fileRecord: FileRecord): void {
    // 更新节点存储信息
    let nodeInfo = this.nodeStorageMap.get(this.localNodeId);
    if (!nodeInfo) {
      nodeInfo = {
        nodeId: this.localNodeId,
        host: 'localhost',
        port: 0,
        fileIds: [],
        totalSize: 0,
        lastSeen: Date.now(),
      };
    }

    if (!nodeInfo.fileIds.includes(fileRecord.id)) {
      nodeInfo.fileIds.push(fileRecord.id);
      nodeInfo.totalSize += fileRecord.size;
      nodeInfo.lastSeen = Date.now();
      this.nodeStorageMap.set(this.localNodeId, nodeInfo);
    }

    // 更新文件位置信息
    let fileLocation = this.fileLocationMap.get(fileRecord.id);
    if (!fileLocation) {
      fileLocation = {
        fileId: fileRecord.id,
        filename: fileRecord.filename,
        size: fileRecord.size,
        hash: fileRecord.hash,
        storedOn: [],
        redundancy: 0,
      };
    }

    if (!fileLocation.storedOn.includes(this.localNodeId)) {
      fileLocation.storedOn.push(this.localNodeId);
      fileLocation.redundancy = fileLocation.storedOn.length;
    }

    this.fileLocationMap.set(fileRecord.id, fileLocation);
    this.saveIndex();
  }

  /**
   * 注册远程节点存储的文件（通过P2P发现）
   */
  registerRemoteFile(nodeId: string, fileId: string, fileInfo: Partial<FileRecord>): void {
    // 更新文件位置信息
    let fileLocation = this.fileLocationMap.get(fileId);
    if (!fileLocation) {
      fileLocation = {
        fileId,
        filename: fileInfo.filename || 'unknown',
        size: fileInfo.size || 0,
        hash: fileInfo.hash || '',
        storedOn: [],
        redundancy: 0,
      };
    }

    if (!fileLocation.storedOn.includes(nodeId)) {
      fileLocation.storedOn.push(nodeId);
      fileLocation.redundancy = fileLocation.storedOn.length;
      this.fileLocationMap.set(fileId, fileLocation);
      this.saveIndex();
    }
  }

  /**
   * 更新节点信息
   */
  updateNodeInfo(nodeId: string, host: string, port: number): void {
    const existing = this.nodeStorageMap.get(nodeId);
    if (existing) {
      existing.host = host;
      existing.port = port;
      existing.lastSeen = Date.now();
    } else {
      this.nodeStorageMap.set(nodeId, {
        nodeId,
        host,
        port,
        fileIds: [],
        totalSize: 0,
        lastSeen: Date.now(),
      });
    }
    this.saveIndex();
  }

  /**
   * 获取文件的存储位置
   */
  getFileLocation(fileId: string): FileStorageLocation | undefined {
    return this.fileLocationMap.get(fileId);
  }

  /**
   * 获取所有文件的存储位置
   */
  getAllFileLocations(): FileStorageLocation[] {
    return Array.from(this.fileLocationMap.values());
  }

  /**
   * 获取存储了指定文件的节点列表
   */
  getNodesStoringFile(fileId: string): string[] {
    const location = this.fileLocationMap.get(fileId);
    return location?.storedOn || [];
  }

  /**
   * 获取节点的存储信息
   */
  getNodeStorage(nodeId: string): NodeStorageInfo | undefined {
    return this.nodeStorageMap.get(nodeId);
  }

  /**
   * 获取所有节点的存储信息
   */
  getAllNodeStorage(): NodeStorageInfo[] {
    return Array.from(this.nodeStorageMap.values());
  }

  /**
   * 计算冗余统计信息
   */
  getRedundancyStats(): RedundancyStats {
    const files = Array.from(this.fileLocationMap.values());

    if (files.length === 0) {
      return {
        totalFiles: 0,
        totalUniqueSize: 0,
        totalReplicatedSize: 0,
        averageRedundancy: 0,
        minRedundancy: 0,
        maxRedundancy: 0,
        atRiskFiles: [],
      };
    }

    const redundancies = files.map(f => f.redundancy);
    const totalUniqueSize = files.reduce((sum, f) => sum + f.size, 0);
    const totalReplicatedSize = files.reduce((sum, f) => sum + f.size * f.redundancy, 0);

    return {
      totalFiles: files.length,
      totalUniqueSize,
      totalReplicatedSize,
      averageRedundancy: redundancies.reduce((a, b) => a + b, 0) / files.length,
      minRedundancy: Math.min(...redundancies),
      maxRedundancy: Math.max(...redundancies),
      atRiskFiles: files.filter(f => f.redundancy === 1).map(f => f.fileId),
    };
  }

  /**
   * 检查文件是否有足够的冗余（至少minCopies个副本）
   */
  hasEnoughRedundancy(fileId: string, minCopies: number = 2): boolean {
    const location = this.fileLocationMap.get(fileId);
    return (location?.redundancy || 0) >= minCopies;
  }

  /**
   * 获取需要增加冗余的文件列表（副本数少于目标值）
   */
  getUnderReplicatedFiles(targetCopies: number = 3): FileStorageLocation[] {
    return Array.from(this.fileLocationMap.values()).filter(f => f.redundancy < targetCopies);
  }

  /**
   * 从区块链同步文件列表
   */
  syncWithBlockchain(chain: Block[]): void {
    for (const block of chain) {
      if (block.data.type === 'REGISTER' && block.data.file.id !== 'genesis') {
        const file = block.data.file;
        if (!this.fileLocationMap.has(file.id)) {
          this.fileLocationMap.set(file.id, {
            fileId: file.id,
            filename: file.filename,
            size: file.size,
            hash: file.hash,
            storedOn: [],
            redundancy: 0,
          });
        }
      }
    }
    this.saveIndex();
  }

  /**
   * 清理失效节点（长时间未活跃的节点）
   */
  cleanupStaleNodes(maxAgeMs: number = 24 * 60 * 60 * 1000): string[] {
    const now = Date.now();
    const removedNodes: string[] = [];

    for (const [nodeId, info] of this.nodeStorageMap.entries()) {
      if (nodeId !== this.localNodeId && now - info.lastSeen > maxAgeMs) {
        // 从节点列表中移除
        this.nodeStorageMap.delete(nodeId);
        removedNodes.push(nodeId);

        // 从文件位置中移除该节点
        for (const fileLocation of this.fileLocationMap.values()) {
          const index = fileLocation.storedOn.indexOf(nodeId);
          if (index !== -1) {
            fileLocation.storedOn.splice(index, 1);
            fileLocation.redundancy = fileLocation.storedOn.length;
          }
        }
      }
    }

    if (removedNodes.length > 0) {
      this.saveIndex();
    }

    return removedNodes;
  }
}
