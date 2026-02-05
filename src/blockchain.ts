import * as crypto from 'crypto';

/**
 * 文件注册记录
 */
export interface FileRecord {
  id: string; // 文件唯一ID
  filename: string; // 文件名
  originalPath: string; // 原始路径
  size: number; // 文件大小
  hash: string; // 文件内容哈希
  uploader: string; // 上传者标识
  timestamp: number; // 上传时间戳
  description?: string; // 文件描述
}

/**
 * 区块数据结构
 */
export interface BlockData {
  type: 'REGISTER' | 'DELETE' | 'UPDATE';
  file: FileRecord;
}

/**
 * 区块结构
 */
export interface Block {
  index: number; // 区块索引
  timestamp: number; // 区块创建时间
  data: BlockData; // 区块数据
  previousHash: string; // 前一个区块的哈希
  hash: string; // 当前区块的哈希
  nonce: number; // 工作量证明
}

/**
 * 计算哈希
 */
export function calculateHash(block: Omit<Block, 'hash'>): string {
  const data = JSON.stringify({
    index: block.index,
    timestamp: block.timestamp,
    data: block.data,
    previousHash: block.previousHash,
    nonce: block.nonce,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 创世区块的固定时间戳 (2024-01-01 00:00:00 UTC)
 * 确保所有节点的创世区块完全相同
 */
const GENESIS_TIMESTAMP = 1704067200000;

/**
 * 创建创世区块
 */
export function createGenesisBlock(): Block {
  const block: Omit<Block, 'hash'> = {
    index: 0,
    timestamp: GENESIS_TIMESTAMP,
    data: {
      type: 'REGISTER',
      file: {
        id: 'genesis',
        filename: 'genesis',
        originalPath: '',
        size: 0,
        hash: '0',
        uploader: 'system',
        timestamp: GENESIS_TIMESTAMP,
        description: 'Genesis block',
      },
    },
    previousHash: '0',
    nonce: 0,
  };
  return { ...block, hash: calculateHash(block) };
}

/**
 * 挖矿结果
 */
export interface MineResult {
  success: boolean;
  block?: Block;
  error?: string;
}

/**
 * 挖矿（工作量证明）
 * @param maxAttempts 最大尝试次数，默认 1000 万次
 */
export function mineBlock(
  index: number,
  timestamp: number,
  data: BlockData,
  previousHash: string,
  difficulty: number = 2,
  maxAttempts: number = 10_000_000
): MineResult {
  let nonce = 0;
  let hash = '';
  const target = '0'.repeat(difficulty);

  while (nonce < maxAttempts) {
    const block: Omit<Block, 'hash'> = {
      index,
      timestamp,
      data,
      previousHash,
      nonce,
    };
    hash = calculateHash(block);

    if (hash.startsWith(target)) {
      return { success: true, block: { ...block, hash } };
    }
    nonce++;
  }

  return {
    success: false,
    error: `Mining failed: exceeded maximum attempts (${maxAttempts})`,
  };
}

/**
 * 验证区块是否有效
 */
export function isValidBlock(newBlock: Block, previousBlock: Block): boolean {
  if (previousBlock.index + 1 !== newBlock.index) {
    return false;
  }
  if (previousBlock.hash !== newBlock.previousHash) {
    return false;
  }
  if (calculateHash(newBlock) !== newBlock.hash) {
    return false;
  }
  return true;
}

/**
 * 区块链类
 */
export class Blockchain {
  chain: Block[] = [];
  difficulty: number = 2;
  private fileIndex: Map<string, Block> = new Map(); // 快速查找文件

  constructor() {
    this.chain.push(createGenesisBlock());
  }

  /**
   * 获取最新区块
   */
  getLatestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  /**
   * 添加新区块
   * @throws Error 当挖矿失败时抛出错误
   */
  addBlock(data: BlockData): Block {
    const previousBlock = this.getLatestBlock();
    const result = mineBlock(
      previousBlock.index + 1,
      Date.now(),
      data,
      previousBlock.hash,
      this.difficulty
    );

    if (!result.success || !result.block) {
      throw new Error(result.error || 'Mining failed');
    }

    const newBlock = result.block;
    this.chain.push(newBlock);
    this.fileIndex.set(data.file.id, newBlock);

    return newBlock;
  }

  /**
   * 验证整个链是否有效
   */
  isChainValid(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (!isValidBlock(current, previous)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 替换链（用于同步）
   */
  replaceChain(newChain: Block[]): boolean {
    if (newChain.length <= this.chain.length) {
      return false;
    }
    if (!this.isNewChainValid(newChain)) {
      return false;
    }

    this.chain = newChain;
    this.rebuildIndex();
    return true;
  }

  /**
   * 验证新链是否有效
   */
  private isNewChainValid(chain: Block[]): boolean {
    if (chain[0].hash !== createGenesisBlock().hash) {
      return false;
    }

    for (let i = 1; i < chain.length; i++) {
      if (!isValidBlock(chain[i], chain[i - 1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * 重建文件索引
   */
  private rebuildIndex(): void {
    this.fileIndex.clear();
    for (const block of this.chain) {
      this.fileIndex.set(block.data.file.id, block);
    }
  }

  /**
   * 查找文件
   */
  findFile(fileId: string): Block | undefined {
    return this.fileIndex.get(fileId);
  }

  /**
   * 获取所有文件记录
   */
  getAllFiles(): FileRecord[] {
    const files: FileRecord[] = [];
    const seen = new Set<string>();

    // 从后往前遍历，获取最新的文件状态
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const block = this.chain[i];
      const file = block.data.file;

      if (file.id !== 'genesis' && !seen.has(file.id)) {
        seen.add(file.id);
        if (block.data.type !== 'DELETE') {
          files.unshift(file);
        }
      }
    }

    return files;
  }

  /**
   * 获取链的长度
   */
  get length(): number {
    return this.chain.length;
  }
}
