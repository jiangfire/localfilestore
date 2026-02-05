# LocalFileStore - 基于区块链的本地文件共享系统

一个去中心化的本地文件注册与分发系统，采用类区块链技术维护文件账本，支持多节点P2P网络同步。

## 特性

- 🔗 **区块链账本**: 使用工作量证明(PoW)维护不可篡改的文件注册记录
- 🌐 **P2P网络**: 多节点自动同步账本，支持文件在节点间传输
- 📦 **单文件分发**: 使用ncc打包成单个可执行文件，便于分发部署
- 🔍 **文件验证**: SHA-256哈希验证确保文件完整性
- 📡 **RESTful API**: HTTP API便于客户端交互

## 项目结构

```
localfilestore/
├── src/
│   ├── index.ts      # 命令行入口
│   ├── blockchain.ts # 区块链核心模块
│   ├── p2p.ts        # P2P网络模块
│   ├── server.ts     # 服务器实现
│   └── client.ts     # 客户端实现
├── dist/
│   └── index.js      # ncc打包后的单文件
├── package.json
├── tsconfig.json
└── README.md
```

## 安装与构建

```bash
# 安装依赖
npm install

# 编译TypeScript
npm run build

# 打包成单文件
npm run bundle
```

## 使用方法

### 启动服务器节点

```bash
# 启动第一个节点（种子节点）
node dist/index.js server --http-port 3000 --p2p-port 6000 --data-dir ./data1

# 启动第二个节点并连接到第一个节点
node dist/index.js server --http-port 3001 --p2p-port 6001 --data-dir ./data2 --peers localhost:6000
```

服务器参数:
- `--http-port`: HTTP API端口 (默认: 3000)
- `--p2p-port`: P2P网络端口 (默认: 6000)
- `--data-dir`: 数据存储目录 (默认: ./data)
- `--peers`: 种子节点列表，格式: `host:port,host:port`

### 客户端命令

#### 注册文件

```bash
node dist/index.js client register ./myfile.txt --uploader "Alice" --description "重要文档"
```

#### 列出所有文件

```bash
node dist/index.js client list
```

#### 下载文件

```bash
# 下载到默认目录
node dist/index.js client download <file-id>

# 指定输出路径
node dist/index.js client download <file-id> --output ./downloads/myfile.txt
```

#### 查看区块链

```bash
node dist/index.js client chain
```

#### 查看网络节点

```bash
node dist/index.js client peers
```

#### 连接到新节点

```bash
node dist/index.js client connect localhost:6001
```

#### 验证文件哈希

```bash
node dist/index.js client verify <file-id> ./myfile.txt
```

### 客户端通用参数

```bash
--host <host>         # 服务器主机 (默认: localhost)
--port <port>         # 服务器端口 (默认: 3000)
--download-dir <path> # 下载目录 (默认: ./downloads)
```

## 工作流程

### 文件注册流程

1. Client向Server发送文件注册请求
2. Server计算文件SHA-256哈希
3. Server创建新区块（包含文件元数据）并挖矿
4. Server将区块广播到P2P网络
5. 其他节点验证并同步新区块

### 文件下载流程

1. Client向Server发送下载请求
2. Server检查本地是否存储该文件
3. 如果有，直接返回文件
4. 如果没有，从P2P网络请求文件
5. 验证文件哈希后返回给Client

### P2P同步机制

- 节点启动时连接到种子节点
- 新节点自动同步完整区块链
- 新区块产生时广播到所有连接节点
- 采用最长链原则解决分叉

## API 文档

### POST /api/register
注册新文件

请求体:
```json
{
  "filename": "example.txt",
  "filepath": "/path/to/file.txt",
  "uploader": "Alice",
  "description": "重要文档"
}
```

### GET /api/files
获取所有注册的文件列表

### GET /api/files/:id
下载指定文件

### POST /api/download
从网络下载文件

请求体:
```json
{
  "fileId": "xxx",
  "savePath": "/path/to/save"
}
```

### GET /api/chain
获取完整区块链

### GET /api/peers
获取连接的节点列表

### POST /api/connect
连接到新节点

请求体:
```json
{
  "host": "localhost",
  "port": 6001
}
```

## 数据存储

每个服务器节点维护以下数据:

- `blockchain.json`: 区块链数据
- `files/`: 存储的文件数据

## 技术细节

### 区块链

- 使用SHA-256哈希
- 工作量证明难度: 2 (前缀2个0)
- 区块结构: index, timestamp, data, previousHash, hash, nonce
- **固定创世区块**: 所有节点使用相同的创世区块（时间戳固定为 2024-01-01 00:00:00 UTC），确保全网账本一致性

### P2P网络

- 基于TCP Socket
- 消息格式: 换行分隔的JSON
- 支持区块广播、文件传输

## 注意事项

1. **安全性**: 当前实现适合内部网络使用，不建议直接暴露到公网
2. **存储**: 每个节点都会存储完整的区块链和所有文件
3. **冲突解决**: 采用最长链原则，可能存在短暂分叉

## 许可证

MIT
