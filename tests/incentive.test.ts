import { IncentiveManager, IncentiveType, DEFAULT_INCENTIVE_CONFIG } from '../src/incentive';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('IncentiveManager', () => {
  let tempDir: string;
  let manager: IncentiveManager;
  const nodeId = 'test-node-123';

  beforeEach(() => {
    // 创建临时目录
    tempDir = path.join(tmpdir(), `incentive-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    manager = new IncentiveManager(tempDir, nodeId);
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('账户管理', () => {
    test('应该为新节点创建账户', () => {
      const account = manager.getLocalAccount();
      expect(account.nodeId).toBe(nodeId);
      expect(account.balance).toBe(0);
      expect(account.totalEarned).toBe(0);
    });

    test('应该获取指定节点的账户', () => {
      // 先触发账户创建
      manager.getLocalAccount();
      const account = manager.getAccount(nodeId);
      expect(account).toBeDefined();
      expect(account?.nodeId).toBe(nodeId);
    });

    test('不存在的节点应该返回undefined', () => {
      const account = manager.getAccount('non-existent');
      expect(account).toBeUndefined();
    });

    test('应该获取所有账户', () => {
      // 先触发账户创建
      manager.getLocalAccount();
      const accounts = manager.getAllAccounts();
      expect(accounts.length).toBe(1);
      expect(accounts[0].nodeId).toBe(nodeId);
    });
  });

  describe('存储奖励', () => {
    test('应该正确计算存储奖励', () => {
      const fileId = 'file-123';
      const fileSize = 1024 * 1024 * 10; // 10MB
      const storageDays = 5;
      const blockIndex = 1;

      const record = manager.recordStorageReward(nodeId, fileId, fileSize, storageDays, blockIndex);

      expect(record.type).toBe(IncentiveType.STORAGE);
      expect(record.nodeId).toBe(nodeId);
      expect(record.fileId).toBe(fileId);
      expect(record.blockIndex).toBe(blockIndex);
      expect(record.amount).toBeGreaterThan(0);

      // 验证账户余额
      const account = manager.getLocalAccount();
      expect(account.balance).toBe(record.amount);
      expect(account.totalEarned).toBe(record.amount);
    });

    test('存储奖励应该随时间增长', () => {
      const fileId1 = 'file-1';
      const fileId2 = 'file-2';
      const fileSize = 1024 * 1024; // 1MB

      const record1 = manager.recordStorageReward(nodeId, fileId1, fileSize, 1, 1);
      const record2 = manager.recordStorageReward(nodeId, fileId2, fileSize, 10, 2);

      // 存储10天的奖励应该比1天高
      expect(record2.amount).toBeGreaterThan(record1.amount);
    });
  });

  describe('带宽奖励', () => {
    test('应该正确计算带宽奖励', () => {
      const fileId = 'file-123';
      const bytesTransferred = 1024 * 1024 * 5; // 5MB
      const blockIndex = 1;

      const record = manager.recordBandwidthReward(nodeId, fileId, bytesTransferred, blockIndex);

      expect(record.type).toBe(IncentiveType.BANDWIDTH);
      expect(record.amount).toBe(5 * DEFAULT_INCENTIVE_CONFIG.downloadRewardPerMB);
    });

    test('小文件奖励应该符合预期', () => {
      const fileId = 'file-small';
      const bytesTransferred = 100; // 100 bytes = 0.000095 MB
      const blockIndex = 1;

      const record = manager.recordBandwidthReward(nodeId, fileId, bytesTransferred, blockIndex);

      // 100 bytes = 0.000095 MB, 奖励 = 0.000095 * 0.05 = 0.00000475
      // 由于精度问题可能为0，使用toFixed(2)后确实是0
      expect(record.amount).toBe(0);
    });
  });

  describe('在线时长奖励', () => {
    test('应该正确计算在线奖励', () => {
      const hours = 24;
      const blockIndex = 1;

      const record = manager.recordUptimeReward(nodeId, hours, blockIndex);

      expect(record.type).toBe(IncentiveType.UPTIME);
      expect(record.amount).toBe(hours * DEFAULT_INCENTIVE_CONFIG.uptimeRewardPerHour);
    });

    test('calculateUptimeReward 应该返回null如果不足1小时', () => {
      const result = manager.calculateUptimeReward(1);
      // 刚创建的manager，在线时间不足1小时
      expect(result).toBeNull();
    });
  });

  describe('验证奖励', () => {
    test('应该发放验证奖励', () => {
      const blockIndex = 5;

      const record = manager.recordValidationReward(nodeId, blockIndex);

      expect(record.type).toBe(IncentiveType.VALIDATION);
      expect(record.amount).toBe(DEFAULT_INCENTIVE_CONFIG.validationReward);
      expect(record.blockIndex).toBe(blockIndex);
    });
  });

  describe('奖励记录查询', () => {
    beforeEach(() => {
      // 创建一些奖励记录
      manager.recordStorageReward(nodeId, 'file-1', 1024 * 1024, 1, 1);
      manager.recordBandwidthReward(nodeId, 'file-1', 1024 * 1024, 2);
      manager.recordValidationReward(nodeId, 3);
      manager.recordStorageReward('other-node', 'file-2', 1024 * 1024, 1, 4);
    });

    test('应该按节点查询记录', () => {
      const records = manager.getRecordsByNode(nodeId);
      expect(records.length).toBe(3);
    });

    test('应该按类型查询记录', () => {
      // STORAGE类型记录：当前节点和其他节点都有
      const storageRecords = manager.getRecordsByType(IncentiveType.STORAGE);
      expect(storageRecords.length).toBeGreaterThanOrEqual(1);

      const validationRecords = manager.getRecordsByType(IncentiveType.VALIDATION);
      expect(validationRecords.length).toBeGreaterThanOrEqual(1);
    });

    test('应该获取节点奖励统计', () => {
      const stats = manager.getNodeRewardStats(nodeId);

      expect(stats.totalEarned).toBeGreaterThan(0);
      expect(stats.byType[IncentiveType.STORAGE]).toBeGreaterThan(0);
      expect(stats.byType[IncentiveType.BANDWIDTH]).toBeGreaterThan(0);
      expect(stats.byType[IncentiveType.VALIDATION]).toBeGreaterThan(0);
    });
  });

  describe('全局统计', () => {
    test('应该计算全局统计', () => {
      // 创建一些记录
      manager.recordStorageReward(nodeId, 'file-1', 1024 * 1024, 1, 1);
      manager.recordStorageReward('node-2', 'file-2', 1024 * 1024, 1, 2);

      const stats = manager.getGlobalStats();

      expect(stats.totalIssued).toBeGreaterThan(0);
      expect(stats.totalAccounts).toBeGreaterThan(0);
      expect(stats.topNodes.length).toBeGreaterThan(0);
    });

    test('空状态应该返回0统计', () => {
      const stats = manager.getGlobalStats();
      expect(stats.totalIssued).toBe(0);
      expect(stats.totalAccounts).toBeGreaterThanOrEqual(0); // 可能为0（如果没有触发账户创建）
    });
  });

  describe('提取代币', () => {
    test('应该成功提取', () => {
      // 先获得一些奖励
      manager.recordValidationReward(nodeId, 1);
      const account = manager.getLocalAccount();
      const initialBalance = account.balance;

      const result = manager.withdraw(5);

      expect(result.success).toBe(true);
      expect(manager.getLocalAccount().balance).toBe(initialBalance - 5);
      expect(manager.getLocalAccount().totalWithdrawn).toBe(5);
    });

    test('余额不足应该失败', () => {
      const result = manager.withdraw(100);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
    });

    test('无效金额应该失败', () => {
      const result = manager.withdraw(0);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    test('负金额应该失败', () => {
      const result = manager.withdraw(-10);

      expect(result.success).toBe(false);
    });
  });

  describe('持久化', () => {
    test('数据应该保存到文件', () => {
      manager.recordValidationReward(nodeId, 1);

      // 创建新实例读取数据
      const newManager = new IncentiveManager(tempDir, nodeId);
      const account = newManager.getLocalAccount();

      expect(account.totalEarned).toBe(DEFAULT_INCENTIVE_CONFIG.validationReward);
    });
  });

  describe('自定义配置', () => {
    test('应该使用自定义配置', () => {
      const customManager = new IncentiveManager(tempDir, nodeId, {
        validationReward: 100,
      });

      const record = customManager.recordValidationReward(nodeId, 1);
      expect(record.amount).toBe(100);
    });
  });
});
