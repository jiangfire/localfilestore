import { FileServer } from './server';
import { FileClient } from './client';

/**
 * 命令行选项类型
 */
interface CommandOptions {
  command?: string;
  http_port?: string;
  p2p_port?: string;
  data_dir?: string;
  peers?: string[];
  host?: string;
  port?: string;
  download_dir?: string;
  uploader?: string;
  description?: string;
  output?: string;
  [key: string]: string | string[] | boolean | undefined;
}

/**
 * 解析参数结果
 */
interface ParseArgsResult {
  command: string;
  options: CommandOptions;
  positional: string[];
}

/**
 * 错误对象类型
 */
interface ErrorWithMessage {
  message: string;
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
📦 LocalFileStore - 基于区块链的本地文件共享系统

用法:
  node index.js <command> [options]

命令:

  server                    启动区块链文件服务器
    --http-port <port>      HTTP API端口 (默认: 3000)
    --p2p-port <port>       P2P网络端口 (默认: 6000)
    --data-dir <path>       数据存储目录 (默认: ./data)
    --peers <list>          种子节点列表,格式: host:port,host:port

  client                    启动客户端模式
    --host <host>           服务器主机 (默认: localhost)
    --port <port>           服务器端口 (默认: 3000)
    --download-dir <path>   下载目录 (默认: ./downloads)

  client list               列出所有注册的文件

  client register <path>    注册文件到区块链
    --uploader <name>       上传者名称
    --description <text>    文件描述

  client download <fileId>  下载文件
    --output <path>         输出路径 (默认: 下载目录)

  client chain              查看区块链信息

  client peers              查看连接的节点

  client connect <host:port> 连接到新节点

  client verify <fileId> <filepath> 验证文件哈希

示例:
  # 启动第一个服务器节点
  node index.js server --http-port 3000 --p2p-port 6000 --data-dir ./data1

  # 启动第二个服务器节点并连接到第一个
  node index.js server --http-port 3001 --p2p-port 6001 --data-dir ./data2 --peers localhost:6000

  # 客户端注册文件
  node index.js client register ./myfile.txt --uploader "Alice" --description "重要文档"

  # 客户端下载文件
  node index.js client download <file-id> --output ./downloads/

  # 查看文件列表
  node index.js client list
`);
}

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): ParseArgsResult {
  const options: CommandOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const value = args[i + 1];

      if (value && !value.startsWith('--')) {
        // 处理数组类型的参数
        if (key === 'peers') {
          options[key] = value.split(',');
        } else {
          options[key] = value;
        }
        i++;
      } else {
        options[key] = true;
      }
    } else if (!options.command) {
      options.command = arg;
    } else {
      positional.push(arg);
    }
  }

  return {
    command: options.command || '',
    options,
    positional,
  };
}

/**
 * 启动服务器
 */
async function startServer(options: CommandOptions): Promise<void> {
  const httpPort = parseInt(options.http_port || '3000', 10);
  const p2pPort = parseInt(options.p2p_port || '6000', 10);
  const dataDir = typeof options.data_dir === 'string' ? options.data_dir : './data';
  const seedPeers: string[] = Array.isArray(options.peers) ? options.peers : [];

  console.log(`
╔══════════════════════════════════════════════════════════╗
║         LocalFileStore - 区块链文件服务器                 ║
╚══════════════════════════════════════════════════════════╝
`);

  const server = new FileServer({
    httpPort,
    p2pPort,
    dataDir,
    seedPeers,
  });

  // 处理退出
  process.on('SIGINT', () => {
    console.log('\n[Main] Shutting down server...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });

  try {
    await server.start();
    console.log('\n✅ Server is running! Press Ctrl+C to stop.\n');
  } catch (err) {
    const error = err as ErrorWithMessage;
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

/**
 * 运行客户端命令
 */
async function runClient(options: CommandOptions, positional: string[]): Promise<void> {
  const host = typeof options.host === 'string' ? options.host : 'localhost';
  const port = parseInt(options.port || '3000', 10);
  const downloadDir =
    typeof options.download_dir === 'string' ? options.download_dir : './downloads';

  const client = new FileClient({
    serverHost: host,
    serverPort: port,
    downloadDir,
  });

  const subCommand = positional[0];

  switch (subCommand) {
    case 'list':
      await client.showFileList();
      break;

    case 'register': {
      const filepath = positional[1];
      if (!filepath) {
        console.error('❌ Error: Please specify a file path');
        process.exit(1);
      }
      const result = await client.registerFile(
        filepath,
        typeof options.uploader === 'string' ? options.uploader : undefined,
        typeof options.description === 'string' ? options.description : undefined
      );
      if (!result.success) {
        console.error(`❌ Error: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
      break;
    }

    case 'download': {
      const fileId = positional[1];
      if (!fileId) {
        console.error('❌ Error: Please specify a file ID');
        process.exit(1);
      }
      const result = await client.downloadFile(
        fileId,
        typeof options.output === 'string' ? options.output : undefined
      );
      if (!result.success) {
        console.error(`❌ Error: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
      break;
    }

    case 'chain':
      await client.showChain();
      break;

    case 'peers':
      await client.showPeers();
      break;

    case 'connect': {
      const peer = positional[1];
      if (!peer) {
        console.error('❌ Error: Please specify peer address (host:port)');
        process.exit(1);
      }
      const [peerHost, peerPortStr] = peer.split(':');
      if (!peerHost || !peerPortStr) {
        console.error('❌ Error: Invalid peer address format. Use host:port');
        process.exit(1);
      }
      const result = await client.connectPeer(peerHost, parseInt(peerPortStr, 10));
      if (!result.success) {
        console.error(`❌ Error: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
      break;
    }

    case 'verify': {
      const fileId = positional[1];
      const filepath = positional[2];
      if (!fileId || !filepath) {
        console.error('❌ Error: Please specify fileId and filepath');
        process.exit(1);
      }
      const result = await client.verifyFile(fileId, filepath);
      if (!result.success) {
        console.error(`❌ Error: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`❌ Unknown client command: ${subCommand}`);
      console.log('Run without arguments to see help.');
      process.exit(1);
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const { command, options, positional } = parseArgs(args);

  switch (command) {
    case 'server':
      await startServer(options);
      break;

    case 'client':
      await runClient(options, positional);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// 运行主程序
main().catch((err: unknown) => {
  const error = err as ErrorWithMessage;
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
