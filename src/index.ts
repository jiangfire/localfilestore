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
📦 LocalFileStore - Blockchain-based local file sharing system

Usage:
  node index.js <command> [options]

Commands:

  server                    Start blockchain file server
    --http-port <port>      HTTP API port (default: 3000)
    --p2p-port <port>       P2P network port (default: 6000)
    --data-dir <path>       Data storage directory (default: ./data)
    --peers <list>          Seed peer list, format: host:port,host:port

  client                    Start client mode
    --host <host>           Server host (default: localhost)
    --port <port>           Server port (default: 3000)
    --download-dir <path>   Download directory (default: ./downloads)

  client list               List all registered files

  client register <path>    Register file to blockchain
    --uploader <name>       Uploader name
    --description <text>    File description

  client download <fileId>  Download file
    --output <path>         Output path (default: download directory)

  client chain              View blockchain information

  client peers              View connected peers

  client connect <host:port> Connect to new peer

  client verify <fileId> <filepath> Verify file hash

Examples:
  # Start first server node
  node index.js server --http-port 3000 --p2p-port 6000 --data-dir ./data1

  # Start second server node and connect to first
  node index.js server --http-port 3001 --p2p-port 6001 --data-dir ./data2 --peers localhost:6000

  # Client register file
  node index.js client register ./myfile.txt --uploader "Alice" --description "Important document"

  # Client download file
  node index.js client download <file-id> --output ./downloads/

  # View file list
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
║         LocalFileStore - Blockchain File Server          ║
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
