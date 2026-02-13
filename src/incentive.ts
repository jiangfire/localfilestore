import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 激励类型
 */
export enum IncentiveType {
  STORAGE = 'STORAGE', // 存储奖励
  BANDWIDTH = 'BANDWIDTH', // 带宽奖励（提供下载）
  UPTIME = 'UPTIME', // 在线时长奖励
  VALIDATION = 'VALIDATION', // 验证奖励（区块验证）
}

/**
 * 激励记录
 */
export interface IncentiveRecord {
  id: string; // 记录ID
  type: IncentiveType; // 激励类型
  nodeId: string; // 节点ID
  fileId?: string; // 相关文件ID（存储/带宽奖励）
  amount: number; // 奖励数量
  timestamp: number; // 时间戳
  blockIndex: number; // 关联的区块索引
  description: string; // 描述
}

/**
 * 节点激励账户
 */
export interface NodeAccount {
  nodeId: string; // 节点ID
  balance: number; // 当前余额
  totalEarned: number; // 总收益
  totalWithdrawn: number; // 总提取
  lastUpdated: number; // 最后更新时间
}

/**
 * 激励配置
 */
export interface IncentiveConfig {
  storageRewardPerMB: number; // 每MB存储奖励
  storageRewardPerDay: number; // 每天存储奖励系数
  downloadRewardPerMB: number; // 每MB下载流量奖励
  uptimeRewardPerHour: number; // 每小时在线奖励
  validationReward: number; // 每次验证奖励
  minStorageDuration: number; // 最小存储时间（毫秒）
}

/**
 * 默认激励配置
 */
export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = {
  storageRewardPerMB: 0.1, // 每MB存储奖励 0.1 代币
  storageRewardPerDay: 1.0, // 每天存储倍数
  downloadRewardPerMB: 0.05, // 每MB下载奖励 0.05 代币
  uptimeRewardPerHour: 10, // 每小时在线奖励 10 代币
  validationReward: 5, // 每次验证奖励 5 代币
  minStorageDuration: 24 * 60 * 60 * 1000, // 最小存储1天
};

/**
 * 激励管理器
 */
export class IncentiveManager {
  private config: IncentiveConfig;
  private dataDir: string;
  private recordsPath: string;
  private accountsPath: string;
  private records: IncentiveRecord[] = [];
  private accounts: Map<string, NodeAccount> = new Map();
  private localNodeId: string;
  private uptimeStart: number = Date.now();

  constructor(dataDir: string, nodeId: string, config?: Partial<IncentiveConfig>) {
    this.dataDir = dataDir;
    this.localNodeId = nodeId;
    this.config = { ...DEFAULT_INCENTIVE_CONFIG, ...config };
    this.recordsPath = path.join(dataDir, 'incentive-records.json');
    this.accountsPath = path.join(dataDir, 'incentive-accounts.json');

    this.loadData();
  }

  /**
   * 加载数据
   */
  private loadData(): void {
    // 加载记录
    if (fs.existsSync(this.recordsPath)) {
      try {
        this.records = JSON.parse(fs.readFileSync(this.recordsPath, 'utf-8')) as IncentiveRecord[];
      } catch {
        this.records = [];
      }
    }

    // 加载账户
    if (fs.existsSync(this.accountsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.accountsPath, 'utf-8')) as {
          accounts?: [string, NodeAccount][];
        };
        this.accounts = new Map(data.accounts || []);
      } catch {
        this.accounts = new Map();
      }
    }
  }

  /**
   * 保存数据
   */
  private saveData(): void {
    try {
      fs.writeFileSync(this.recordsPath, JSON.stringify(this.records, null, 2));
      fs.writeFileSync(
        this.accountsPath,
        JSON.stringify({ accounts: Array.from(this.accounts.entries()) }, null, 2)
      );
    } catch (err) {
      console.error('[Incentive] Failed to save data:', err);
    }
  }

  /**
   * 获取或创建账户
   */
  private getOrCreateAccount(nodeId: string): NodeAccount {
    let account = this.accounts.get(nodeId);
    if (!account) {
      account = {
        nodeId,
        balance: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
        lastUpdated: Date.now(),
      };
      this.accounts.set(nodeId, account);
    }
    return account;
  }

  /**
   * 发放奖励
   */
  private issueReward(
    type: IncentiveType,
    nodeId: string,
    amount: number,
    blockIndex: number,
    fileId?: string,
    description?: string
  ): IncentiveRecord {
    const record: IncentiveRecord = {
      id: crypto.randomUUID(),
      type,
      nodeId,
      fileId,
      amount,
      timestamp: Date.now(),
      blockIndex,
      description: description || `${type} reward`,
    };

    // 更新账户
    const account = this.getOrCreateAccount(nodeId);
    account.balance += amount;
    account.totalEarned += amount;
    account.lastUpdated = Date.now();

    // 保存记录
    this.records.push(record);
    this.saveData();

    console.log(`[Incentive] Issued ${amount} tokens to ${nodeId} for ${type}`);

    return record;
  }

  /**
   * 记录存储奖励
   */
  recordStorageReward(
    nodeId: string,
    fileId: string,
    fileSize: number,
    storageDays: number,
    blockIndex: number
  ): IncentiveRecord {
    const sizeMB = fileSize / (1024 * 1024);
    const amount =
      sizeMB *
      this.config.storageRewardPerMB *
      Math.max(1, storageDays * this.config.storageRewardPerDay);

    return this.issueReward(
      IncentiveType.STORAGE,
      nodeId,
      Math.round(amount * 100) / 100,
      blockIndex,
      fileId,
      `Storage reward for ${sizeMB.toFixed(2)}MB x ${storageDays} days`
    );
  }

  /**
   * 记录下载带宽奖励
   */
  recordBandwidthReward(
    nodeId: string,
    fileId: string,
    bytesTransferred: number,
    blockIndex: number
  ): IncentiveRecord {
    const sizeMB = bytesTransferred / (1024 * 1024);
    const amount = sizeMB * this.config.downloadRewardPerMB;

    return this.issueReward(
      IncentiveType.BANDWIDTH,
      nodeId,
      Math.round(amount * 100) / 100,
      blockIndex,
      fileId,
      `Bandwidth reward for serving ${sizeMB.toFixed(2)}MB`
    );
  }

  /**
   * 记录在线时长奖励
   */
  recordUptimeReward(nodeId: string, hours: number, blockIndex: number): IncentiveRecord {
    const amount = hours * this.config.uptimeRewardPerHour;

    return this.issueReward(
      IncentiveType.UPTIME,
      nodeId,
      Math.round(amount * 100) / 100,
      blockIndex,
      undefined,
      `Uptime reward for ${hours} hours online`
    );
  }

  /**
   * 记录验证奖励
   */
  recordValidationReward(nodeId: string, blockIndex: number): IncentiveRecord {
    return this.issueReward(
      IncentiveType.VALIDATION,
      nodeId,
      this.config.validationReward,
      blockIndex,
      undefined,
      `Block validation reward for block #${blockIndex}`
    );
  }

  /**
   * 计算并发放本地节点的在线奖励
   */
  calculateUptimeReward(currentBlockIndex: number): IncentiveRecord | null {
    const hoursOnline = (Date.now() - this.uptimeStart) / (60 * 60 * 1000);

    if (hoursOnline >= 1) {
      const record = this.recordUptimeReward(
        this.localNodeId,
        Math.floor(hoursOnline),
        currentBlockIndex
      );
      // 重置计时
      this.uptimeStart = Date.now();
      return record;
    }

    return null;
  }

  /**
   * 获取账户信息
   */
  getAccount(nodeId: string): NodeAccount | undefined {
    return this.accounts.get(nodeId);
  }

  /**
   * 获取本地节点账户
   */
  getLocalAccount(): NodeAccount {
    return this.getOrCreateAccount(this.localNodeId);
  }

  /**
   * 获取所有账户
   */
  getAllAccounts(): NodeAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * 查询节点的奖励记录
   */
  getRecordsByNode(nodeId: string): IncentiveRecord[] {
    return this.records.filter(r => r.nodeId === nodeId);
  }

  /**
   * 查询特定类型的奖励记录
   */
  getRecordsByType(type: IncentiveType): IncentiveRecord[] {
    return this.records.filter(r => r.type === type);
  }

  /**
   * 获取节点的总奖励统计
   */
  getNodeRewardStats(nodeId: string): {
    totalEarned: number;
    currentBalance: number;
    byType: Record<IncentiveType, number>;
  } {
    const account = this.accounts.get(nodeId);
    const nodeRecords = this.getRecordsByNode(nodeId);

    const byType: Record<IncentiveType, number> = {
      [IncentiveType.STORAGE]: 0,
      [IncentiveType.BANDWIDTH]: 0,
      [IncentiveType.UPTIME]: 0,
      [IncentiveType.VALIDATION]: 0,
    };

    for (const record of nodeRecords) {
      byType[record.type] += record.amount;
    }

    return {
      totalEarned: account?.totalEarned || 0,
      currentBalance: account?.balance || 0,
      byType,
    };
  }

  /**
   * 获取全网激励统计
   */
  getGlobalStats(): {
    totalIssued: number;
    totalAccounts: number;
    byType: Record<IncentiveType, number>;
    topNodes: { nodeId: string; totalEarned: number }[];
  } {
    const byType: Record<IncentiveType, number> = {
      [IncentiveType.STORAGE]: 0,
      [IncentiveType.BANDWIDTH]: 0,
      [IncentiveType.UPTIME]: 0,
      [IncentiveType.VALIDATION]: 0,
    };

    for (const record of this.records) {
      byType[record.type] += record.amount;
    }

    const totalIssued = Object.values(byType).reduce((a, b) => a + b, 0);

    const topNodes = Array.from(this.accounts.values())
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, 10)
      .map(a => ({ nodeId: a.nodeId, totalEarned: a.totalEarned }));

    return {
      totalIssued,
      totalAccounts: this.accounts.size,
      byType,
      topNodes,
    };
  }

  /**
   * 模拟提取代币（实际实现需要签名验证）
   */
  withdraw(amount: number): { success: boolean; error?: string } {
    const account = this.getLocalAccount();

    if (amount <= 0) {
      return { success: false, error: 'Invalid amount' };
    }

    if (account.balance < amount) {
      return { success: false, error: 'Insufficient balance' };
    }

    account.balance -= amount;
    account.totalWithdrawn += amount;
    account.lastUpdated = Date.now();

    this.saveData();

    console.log(`[Incentive] Withdrawn ${amount} tokens from ${this.localNodeId}`);

    return { success: true };
  }
}
