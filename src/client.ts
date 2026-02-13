import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import type { PeerInfo } from './p2p';

/**
 * 文件记录类型
 */
interface FileRecord {
  id: string;
  filename: string;
  size: number;
  hash: string;
  uploader: string;
  timestamp: number;
  description?: string;
}

/**
 * 区块类型
 */
interface Block {
  index: number;
  timestamp: number;
  hash: string;
  previousHash: string;
  data: {
    type: string;
    file: FileRecord;
  };
}

/**
 * 客户端配置
 */
interface ClientConfig {
  serverHost: string;
  serverPort: number;
  downloadDir?: string;
}

/**
 * API 响应类型
 */
interface ApiResponse {
  success?: boolean;
  error?: string;
  fileId?: string;
  blockIndex?: number;
  hash?: string;
  files?: FileRecord[];
  chain?: Block[];
  peers?: PeerInfo[];
  nodeId?: string;
  source?: string;
  size?: number;
  count?: number;
}

/**
 * 错误对象类型
 */
interface ErrorWithMessage {
  message: string;
}

/**
 * 注册文件结果
 */
interface RegisterFileResult {
  success: boolean;
  fileId?: string;
  hash?: string;
  error?: string;
}

/**
 * 上传文件夹结果
 */
interface UploadFolderResult {
  success: boolean;
  fileId?: string;
  zipPath?: string;
  originalFileCount?: number;
  totalSize?: number;
  error?: string;
}

/**
 * 列出文件结果
 */
interface ListFilesResult {
  success: boolean;
  files?: FileRecord[];
  error?: string;
}

/**
 * 下载文件结果
 */
interface DownloadFileResult {
  success: boolean;
  filepath?: string;
  error?: string;
}

/**
 * 查看链结果
 */
interface ViewChainResult {
  success: boolean;
  chain?: Block[];
  error?: string;
}

/**
 * 查看节点结果
 */
interface ViewPeersResult {
  success: boolean;
  peers?: PeerInfo[];
  nodeId?: string;
  error?: string;
}

/**
 * 连接节点结果
 */
interface ConnectPeerResult {
  success: boolean;
  error?: string;
}

/**
 * 验证文件结果
 */
interface VerifyFileResult {
  success: boolean;
  valid?: boolean;
  error?: string;
}

/**
 * 网络下载结果
 */
interface DownloadFromNetworkResult {
  success: boolean;
  error?: string;
}

/**
 * HTTP 请求选项
 */
interface HttpRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string | number>;
}

/**
 * 区块链文件客户端
 */
export class FileClient {
  private config: ClientConfig;
  private baseUrl: string;
  private downloadDir: string;

  constructor(config: ClientConfig) {
    this.config = config;
    this.baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    this.downloadDir = config.downloadDir || path.join(process.cwd(), 'downloads');

    // 确保下载目录存在
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  /**
   * 注册文件到区块链
   */
  async registerFile(
    filepath: string,
    uploader?: string,
    description?: string
  ): Promise<RegisterFileResult> {
    const resolvedPath = path.resolve(filepath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filepath}` };
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      return { success: false, error: 'Cannot register a directory' };
    }

    const filename = path.basename(resolvedPath);

    try {
      const response = await this.post('/api/register', {
        filename,
        filepath: resolvedPath,
        uploader: uploader || 'anonymous',
        description,
      });

      if (response.success) {
        console.log(`✅ File registered successfully!`);
        console.log(`   File ID: ${response.fileId}`);
        console.log(`   Block: #${response.blockIndex}`);
        console.log(`   Hash: ${response.hash}`);
        return { success: true, fileId: response.fileId, hash: response.hash };
      } else {
        return { success: false, error: response.error };
      }
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 压缩文件夹为ZIP文件
   */
  private async zipFolder(folderPath: string, zipPath: string): Promise<{ success: boolean; fileCount: number; error?: string }> {
    return new Promise((resolve) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      let fileCount = 0;
      
      output.on('close', () => {
        resolve({ success: true, fileCount });
      });
      
      archive.on('error', (err: Error) => {
        resolve({ success: false, fileCount: 0, error: err.message });
      });
      
      archive.on('entry', (entry: archiver.EntryData) => {
        // Count all entries (files and directories)
        fileCount++;
      });
      
      archive.pipe(output);
      archive.directory(folderPath, false);
      archive.finalize();
    });
  }

  /**
   * 上传文件夹（自动压缩为ZIP后上传）
   */
  async uploadFolder(
    folderPath: string,
    uploader?: string,
    description?: string
  ): Promise<UploadFolderResult> {
    const resolvedPath = path.resolve(folderPath);
    
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `Folder not found: ${folderPath}` };
    }
    
    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Path is not a directory' };
    }
    
    const folderName = path.basename(resolvedPath);
    const zipFilename = `${folderName}.zip`;
    const zipPath = path.join(this.downloadDir, zipFilename);
    
    console.log(`📦 Compressing folder: ${folderName}`);
    console.log(`   Source: ${resolvedPath}`);
    
    // 压缩文件夹
    const zipResult = await this.zipFolder(resolvedPath, zipPath);
    
    if (!zipResult.success) {
      return { success: false, error: `Failed to compress folder: ${zipResult.error}` };
    }
    
    console.log(`   Compressed ${zipResult.fileCount} files`);
    console.log(`   ZIP size: ${this.formatSize(fs.statSync(zipPath).size)}`);
    console.log(`   ZIP location: ${zipPath}\n`);
    
    // 构建描述，标记为文件夹压缩包
    const folderDescription = JSON.stringify({
      type: 'folder_archive',
      originalFolderName: folderName,
      fileCount: zipResult.fileCount,
      description: description || '',
    });
    
    // 上传压缩包
    console.log(`📤 Uploading compressed folder...`);
    const uploadResult = await this.registerFile(zipPath, uploader, folderDescription);
    
    if (uploadResult.success) {
      // 可选：上传成功后删除临时ZIP文件
      // fs.unlinkSync(zipPath);
      
      return {
        success: true,
        fileId: uploadResult.fileId,
        zipPath,
        originalFileCount: zipResult.fileCount,
        totalSize: fs.statSync(zipPath).size,
      };
    } else {
      // 上传失败，清理临时文件
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      return { success: false, error: uploadResult.error };
    }
  }

  /**
   * 列出所有注册的文件
   */
  async listFiles(): Promise<ListFilesResult> {
    try {
      const response = await this.get('/api/files');

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, files: response.files };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示文件列表（格式化输出）
   */
  async showFileList(): Promise<void> {
    const result = await this.listFiles();

    if (!result.success || !result.files) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    const files = result.files;

    if (files.length === 0) {
      console.log('📂 No files registered yet.');
      return;
    }

    console.log(`\n📋 Registered Files (${files.length} total):\n`);
    console.log('─'.repeat(100));
    console.log(
      `${'ID'.padEnd(36)} │ ${'Filename'.padEnd(20)} │ ${'Size'.padEnd(10)} │ ${'Uploader'.padEnd(15)} │ Date`
    );
    console.log('─'.repeat(100));

    for (const file of files) {
      const date = new Date(file.timestamp).toLocaleDateString();
      const size = this.formatSize(file.size);
      const filename =
        file.filename.length > 20 ? file.filename.substring(0, 17) + '...' : file.filename;
      const uploader =
        file.uploader.length > 15 ? file.uploader.substring(0, 12) + '...' : file.uploader;

      console.log(
        `${file.id.padEnd(36)} │ ${filename.padEnd(20)} │ ${size.padEnd(10)} │ ${uploader.padEnd(15)} │ ${date}`
      );
    }
    console.log('─'.repeat(100));
  }

  /**
   * 下载文件
   */
  async downloadFile(fileId: string, outputPath?: string): Promise<DownloadFileResult> {
    // 先获取文件信息
    const files = await this.listFiles();
    if (!files.success || !files.files) {
      return { success: false, error: files.error };
    }

    const fileInfo = files.files.find(f => f.id === fileId);
    if (!fileInfo) {
      return { success: false, error: 'File not found in blockchain' };
    }

    // 确定输出路径
    const savePath = outputPath
      ? path.resolve(outputPath)
      : path.join(this.downloadDir, fileInfo.filename);

    // 确保目录存在
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      console.log(`⬇️  Downloading ${fileInfo.filename}...`);

      // 尝试从本地节点直接下载
      const url = `${this.baseUrl}/api/files/${fileId}`;
      await this.downloadToFile(url, savePath);

      // 验证哈希
      const downloadedData = fs.readFileSync(savePath);
      const downloadedHash = crypto.createHash('sha256').update(downloadedData).digest('hex');

      if (downloadedHash !== fileInfo.hash) {
        fs.unlinkSync(savePath);
        return { success: false, error: 'File hash mismatch - download corrupted' };
      }

      console.log(`✅ Download complete: ${savePath}`);
      console.log(`   Size: ${this.formatSize(fileInfo.size)}`);
      console.log(`   Hash verified: ${downloadedHash.substring(0, 16)}...`);

      return { success: true, filepath: savePath };
    } catch {
      // 直接下载失败，尝试通过网络下载
      console.log(`⚠️  Direct download failed, trying network download...`);

      try {
        const response = await this.post('/api/download', {
          fileId,
          savePath,
        });

        if (response.success) {
          console.log(`✅ Download complete: ${savePath}`);
          console.log(`   Source: ${response.source}`);
          if (response.size) {
            console.log(`   Size: ${this.formatSize(response.size)}`);
          }
          return { success: true, filepath: savePath };
        } else {
          return { success: false, error: response.error };
        }
      } catch (err) {
        const error = err as ErrorWithMessage;
        return { success: false, error: `Network download failed: ${error.message}` };
      }
    }
  }

  /**
   * 从网络下载文件（当本地节点没有文件时）
   */
  async downloadFromNetwork(fileId: string, savePath: string): Promise<DownloadFromNetworkResult> {
    try {
      const response = await this.post('/api/download', {
        fileId,
        savePath: path.resolve(savePath),
      });

      if (response.success) {
        return { success: true };
      } else {
        return { success: false, error: response.error };
      }
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 查看区块链信息
   */
  async viewChain(): Promise<ViewChainResult> {
    try {
      const response = await this.get('/api/chain');

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, chain: response.chain };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示区块链信息（格式化输出）
   */
  async showChain(): Promise<void> {
    const result = await this.viewChain();

    if (!result.success || !result.chain) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    console.log(`\n🔗 Blockchain (${result.chain.length} blocks):\n`);

    for (const block of result.chain.slice(-10)) {
      // 只显示最后10个区块
      const date = new Date(block.timestamp).toLocaleString();
      const hashShort = block.hash.substring(0, 16) + '...';
      const prevHashShort = block.previousHash.substring(0, 16) + '...';

      console.log(`Block #${block.index}`);
      console.log(`  Timestamp: ${date}`);
      console.log(`  Hash:      ${hashShort}`);
      console.log(`  Previous:  ${prevHashShort}`);
      console.log(`  File:      ${block.data.file.filename} (${block.data.type})`);
      console.log('');
    }

    if (result.chain.length > 10) {
      console.log(`... and ${result.chain.length - 10} more blocks`);
    }
  }

  /**
   * 查看连接的节点
   */
  async viewPeers(): Promise<ViewPeersResult> {
    try {
      const response = await this.get('/api/peers');

      if (response.error) {
        return { success: false, error: response.error };
      }

      return {
        success: true,
        peers: response.peers,
        nodeId: response.nodeId,
      };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示节点信息（格式化输出）
   */
  async showPeers(): Promise<void> {
    const result = await this.viewPeers();

    if (!result.success) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    console.log(`\n🌐 Network Status:\n`);
    console.log(`Node ID: ${result.nodeId}`);
    console.log(`Connected Peers: ${result.peers?.length || 0}\n`);

    if (result.peers && result.peers.length > 0) {
      console.log('─'.repeat(70));
      console.log(`${'Peer ID'.padEnd(36)} │ ${'Address'.padEnd(25)}`);
      console.log('─'.repeat(70));

      for (const peer of result.peers) {
        const address = `${peer.host}:${peer.port}`;
        console.log(`${peer.id.padEnd(36)} │ ${address.padEnd(25)}`);
      }
      console.log('─'.repeat(70));
    }
  }

  /**
   * 连接新节点
   */
  async connectPeer(host: string, port: number): Promise<ConnectPeerResult> {
    try {
      const response = await this.post('/api/connect', { host, port });

      if (response.success) {
        console.log(`✅ Connected to peer ${host}:${port}`);
        return { success: true };
      } else {
        return { success: false, error: response.error };
      }
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 验证文件哈希
   */
  async verifyFile(fileId: string, filepath: string): Promise<VerifyFileResult> {
    const resolvedPath = path.resolve(filepath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filepath}` };
    }

    // 获取区块链上的文件信息
    const files = await this.listFiles();
    if (!files.success || !files.files) {
      return { success: false, error: files.error };
    }

    const fileInfo = files.files.find(f => f.id === fileId);
    if (!fileInfo) {
      return { success: false, error: 'File not found in blockchain' };
    }

    // 计算本地文件哈希
    const data = fs.readFileSync(resolvedPath);
    const hash = crypto.createHash('sha256').update(data).digest('hex');

    const valid = hash === fileInfo.hash;

    console.log(`\n🔍 File Verification:`);
    console.log(`   File: ${fileInfo.filename}`);
    console.log(`   Blockchain Hash: ${fileInfo.hash}`);
    console.log(`   Local Hash:      ${hash}`);
    console.log(`   Result: ${valid ? '✅ VALID' : '❌ INVALID'}\n`);

    return { success: true, valid };
  }

  /**
   * 查询激励账户
   */
  async viewIncentiveAccount(nodeId?: string): Promise<{
    success: boolean;
    data?: {
      nodeId: string;
      balance: number;
      totalEarned: number;
      totalWithdrawn: number;
      rewardsByType: Record<string, number>;
    };
    error?: string;
  }> {
    try {
      const path = nodeId ? `/api/incentive/account?nodeId=${nodeId}` : '/api/incentive/account';
      const response = await this.get(path);

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, data: response as any };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示激励账户（格式化输出）
   */
  async showIncentiveAccount(nodeId?: string): Promise<void> {
    const result = await this.viewIncentiveAccount(nodeId);

    if (!result.success || !result.data) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    const data = result.data;

    console.log(`\n💰 Incentive Account:
`);
    console.log(`Node ID:        ${data.nodeId}`);
    console.log(`Current Balance: ${data.balance.toFixed(2)} tokens`);
    console.log(`Total Earned:    ${data.totalEarned.toFixed(2)} tokens`);
    console.log(`Total Withdrawn: ${data.totalWithdrawn.toFixed(2)} tokens\n`);

    console.log('Rewards by Type:');
    console.log('─'.repeat(40));
    for (const [type, amount] of Object.entries(data.rewardsByType)) {
      if (amount > 0) {
        console.log(`  ${type.padEnd(12)}: ${amount.toFixed(2)} tokens`);
      }
    }
    console.log('─'.repeat(40));
  }

  /**
   * 查询激励记录
   */
  async viewIncentiveRecords(nodeId?: string): Promise<{
    success: boolean;
    records?: {
      id: string;
      type: string;
      amount: number;
      timestamp: number;
      description: string;
    }[];
    error?: string;
  }> {
    try {
      const path = nodeId ? `/api/incentive/records?nodeId=${nodeId}` : '/api/incentive/records';
      const response = await this.get(path);

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, records: (response as any).records };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示激励记录（格式化输出）
   */
  async showIncentiveRecords(nodeId?: string): Promise<void> {
    const result = await this.viewIncentiveRecords(nodeId);

    if (!result.success || !result.records) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    const records = result.records;

    if (records.length === 0) {
      console.log('\n📭 No incentive records found.\n');
      return;
    }

    console.log(`\n📋 Incentive Records (${records.length} total):\n`);
    console.log('─'.repeat(80));
    console.log(`${'Type'.padEnd(12)} │ ${'Amount'.padEnd(10)} │ ${'Date'.padEnd(20)} │ Description`);
    console.log('─'.repeat(80));

    for (const record of records.slice(0, 20)) { // 只显示前20条
      const date = new Date(record.timestamp).toLocaleString();
      const type = record.type.padEnd(12);
      const amount = record.amount.toFixed(2).padEnd(10);
      console.log(`${type} │ ${amount} │ ${date.padEnd(20)} │ ${record.description}`);
    }

    if (records.length > 20) {
      console.log(`\n... and ${records.length - 20} more records`);
    }
    console.log('─'.repeat(80));
  }

  /**
   * 查询激励统计
   */
  async viewIncentiveStats(): Promise<{
    success: boolean;
    data?: {
      global: {
        totalIssued: number;
        totalAccounts: number;
        topNodes: { nodeId: string; totalEarned: number }[];
      };
      local: {
        nodeId: string;
        totalEarned: number;
        currentBalance: number;
      };
    };
    error?: string;
  }> {
    try {
      const response = await this.get('/api/incentive/stats');

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, data: response as any };
    } catch (err) {
      const error = err as ErrorWithMessage;
      return { success: false, error: `Request failed: ${error.message}` };
    }
  }

  /**
   * 显示激励统计（格式化输出）
   */
  async showIncentiveStats(): Promise<void> {
    const result = await this.viewIncentiveStats();

    if (!result.success || !result.data) {
      console.error(`❌ Error: ${result.error}`);
      return;
    }

    const { global, local } = result.data;

    console.log(`\n📊 Incentive Statistics:\n`);
    
    console.log('Global Stats:');
    console.log(`  Total Issued:    ${global.totalIssued.toFixed(2)} tokens`);
    console.log(`  Total Accounts:  ${global.totalAccounts}\n`);

    console.log('Top Earners:');
    console.log('─'.repeat(60));
    for (let i = 0; i < Math.min(5, global.topNodes.length); i++) {
      const node = global.topNodes[i];
      const shortId = node.nodeId.substring(0, 16) + '...';
      console.log(`  #${i + 1} ${shortId.padEnd(22)} ${node.totalEarned.toFixed(2)} tokens`);
    }
    console.log('─'.repeat(60));

    console.log('\nYour Stats:');
    console.log(`  Node ID:      ${local.nodeId}`);
    console.log(`  Total Earned: ${local.totalEarned.toFixed(2)} tokens`);
    console.log(`  Balance:      ${local.currentBalance.toFixed(2)} tokens\n`);
  }

  /**
   * 发送GET请求
   */
  private get(path: string): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
      const options: HttpRequestOptions = {
        hostname: this.config.serverHost,
        port: this.config.serverPort,
        path,
        method: 'GET',
      };

      const req = http.request(options, (res: http.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
              resolve(parsed as ApiResponse);
            } else {
              resolve({});
            }
          } catch {
            resolve({ error: data });
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * 发送POST请求
   */
  private post(path: string, body: unknown): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
      const jsonData = JSON.stringify(body);

      const options: HttpRequestOptions = {
        hostname: this.config.serverHost,
        port: this.config.serverPort,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonData),
        },
      };

      const req = http.request(options, (res: http.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
              resolve(parsed as ApiResponse);
            } else {
              resolve({});
            }
          } catch {
            resolve({ error: data });
          }
        });
      });

      req.on('error', reject);
      req.write(jsonData);
      req.end();
    });
  }

  /**
   * 下载文件到指定路径
   */
  private downloadToFile(url: string, filepath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filepath);

      http
        .get(url, (response: http.IncomingMessage) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode ?? 'unknown'}`));
            return;
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', err => {
          fs.unlink(filepath, () => {});
          reject(err);
        });
    });
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
