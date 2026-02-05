"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const blockchain_1 = require("../src/blockchain");
describe('Blockchain Core', () => {
    describe('calculateHash', () => {
        it('should generate consistent hash for same input', () => {
            const block = {
                index: 1,
                timestamp: 1234567890,
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'test-file',
                        filename: 'test.txt',
                        originalPath: '/path/to/test.txt',
                        size: 100,
                        hash: 'abc123',
                        uploader: 'tester',
                        timestamp: 1234567890,
                    },
                },
                previousHash: 'previous-hash',
                nonce: 0,
            };
            const hash1 = (0, blockchain_1.calculateHash)(block);
            const hash2 = (0, blockchain_1.calculateHash)(block);
            expect(hash1).toBe(hash2);
            expect(hash1).toHaveLength(64); // SHA-256 hex length
        });
        it('should generate different hash for different input', () => {
            const block1 = {
                index: 1,
                timestamp: 1234567890,
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'test-file',
                        filename: 'test.txt',
                        originalPath: '/path/to/test.txt',
                        size: 100,
                        hash: 'abc123',
                        uploader: 'tester',
                        timestamp: 1234567890,
                    },
                },
                previousHash: 'previous-hash',
                nonce: 0,
            };
            const block2 = { ...block1, nonce: 1 };
            const hash1 = (0, blockchain_1.calculateHash)(block1);
            const hash2 = (0, blockchain_1.calculateHash)(block2);
            expect(hash1).not.toBe(hash2);
        });
    });
    describe('createGenesisBlock', () => {
        it('should create genesis block with index 0', () => {
            const genesis = (0, blockchain_1.createGenesisBlock)();
            expect(genesis.index).toBe(0);
            expect(genesis.previousHash).toBe('0');
            expect(genesis.data.file.id).toBe('genesis');
        });
        it('should create consistent genesis block', () => {
            const genesis1 = (0, blockchain_1.createGenesisBlock)();
            const genesis2 = (0, blockchain_1.createGenesisBlock)();
            expect(genesis1.hash).toBe(genesis2.hash);
        });
    });
    describe('mineBlock', () => {
        it('should mine block with valid hash', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            const result = (0, blockchain_1.mineBlock)(1, Date.now(), data, 'previous-hash', 1);
            expect(result.success).toBe(true);
            expect(result.block).toBeDefined();
            expect(result.block.hash).toMatch(/^0/); // Difficulty 1 means hash starts with '0'
        });
        it('should fail when exceeding max attempts', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            // Very high difficulty with very low max attempts should fail
            const result = (0, blockchain_1.mineBlock)(1, Date.now(), data, 'previous-hash', 10, 100);
            expect(result.success).toBe(false);
            expect(result.error).toContain('exceeded maximum attempts');
        });
    });
    describe('isValidBlock', () => {
        it('should return true for valid block', () => {
            const previousBlock = {
                index: 0,
                timestamp: 1234567890,
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'genesis',
                        filename: 'genesis',
                        originalPath: '',
                        size: 0,
                        hash: '0',
                        uploader: 'system',
                        timestamp: 1234567890,
                        description: 'Genesis block',
                    },
                },
                previousHash: '0',
                hash: 'genesis-hash',
                nonce: 0,
            };
            const newBlock = {
                index: 1,
                timestamp: 1234567891,
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'test',
                        filename: 'test.txt',
                        originalPath: '/path/to/test.txt',
                        size: 100,
                        hash: 'abc123',
                        uploader: 'tester',
                        timestamp: 1234567891,
                    },
                },
                previousHash: 'genesis-hash',
                hash: 'valid-hash',
                nonce: 0,
            };
            // Manually calculate correct hash for validation
            newBlock.hash = (0, blockchain_1.calculateHash)(newBlock);
            expect((0, blockchain_1.isValidBlock)(newBlock, previousBlock)).toBe(true);
        });
        it('should return false for wrong index', () => {
            const previousBlock = (0, blockchain_1.createGenesisBlock)();
            const newBlock = {
                index: 2, // Should be 1
                timestamp: Date.now(),
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'test',
                        filename: 'test.txt',
                        originalPath: '/path/to/test.txt',
                        size: 100,
                        hash: 'abc123',
                        uploader: 'tester',
                        timestamp: Date.now(),
                    },
                },
                previousHash: previousBlock.hash,
                hash: 'some-hash',
                nonce: 0,
            };
            expect((0, blockchain_1.isValidBlock)(newBlock, previousBlock)).toBe(false);
        });
        it('should return false for wrong previous hash', () => {
            const previousBlock = (0, blockchain_1.createGenesisBlock)();
            const newBlock = {
                index: 1,
                timestamp: Date.now(),
                data: {
                    type: 'REGISTER',
                    file: {
                        id: 'test',
                        filename: 'test.txt',
                        originalPath: '/path/to/test.txt',
                        size: 100,
                        hash: 'abc123',
                        uploader: 'tester',
                        timestamp: Date.now(),
                    },
                },
                previousHash: 'wrong-hash',
                hash: 'some-hash',
                nonce: 0,
            };
            expect((0, blockchain_1.isValidBlock)(newBlock, previousBlock)).toBe(false);
        });
    });
});
describe('Blockchain Class', () => {
    let blockchain;
    beforeEach(() => {
        blockchain = new blockchain_1.Blockchain();
    });
    describe('constructor', () => {
        it('should create blockchain with genesis block', () => {
            expect(blockchain.chain).toHaveLength(1);
            expect(blockchain.chain[0].index).toBe(0);
            expect(blockchain.chain[0].data.file.id).toBe('genesis');
        });
    });
    describe('getLatestBlock', () => {
        it('should return genesis block initially', () => {
            const latest = blockchain.getLatestBlock();
            expect(latest.index).toBe(0);
        });
    });
    describe('addBlock', () => {
        it('should add new block to chain', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            const newBlock = blockchain.addBlock(data);
            expect(blockchain.chain).toHaveLength(2);
            expect(newBlock.index).toBe(1);
            expect(newBlock.data.file.id).toBe('test-file');
        });
        it('should link new block to previous block', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            const previousBlock = blockchain.getLatestBlock();
            const newBlock = blockchain.addBlock(data);
            expect(newBlock.previousHash).toBe(previousBlock.hash);
        });
    });
    describe('isChainValid', () => {
        it('should return true for valid chain', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(data);
            expect(blockchain.isChainValid()).toBe(true);
        });
        it('should return false for tampered chain', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(data);
            // Tamper with the data
            blockchain.chain[1].data.file.filename = 'tampered.txt';
            expect(blockchain.isChainValid()).toBe(false);
        });
    });
    describe('findFile', () => {
        it('should find existing file', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(data);
            const found = blockchain.findFile('test-file');
            expect(found).toBeDefined();
            expect(found.data.file.id).toBe('test-file');
        });
        it('should return undefined for non-existing file', () => {
            const found = blockchain.findFile('non-existing');
            expect(found).toBeUndefined();
        });
    });
    describe('getAllFiles', () => {
        it('should return all registered files', () => {
            const file1 = {
                type: 'REGISTER',
                file: {
                    id: 'file-1',
                    filename: 'test1.txt',
                    originalPath: '/path/to/test1.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            const file2 = {
                type: 'REGISTER',
                file: {
                    id: 'file-2',
                    filename: 'test2.txt',
                    originalPath: '/path/to/test2.txt',
                    size: 200,
                    hash: 'def456',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(file1);
            blockchain.addBlock(file2);
            const files = blockchain.getAllFiles();
            expect(files).toHaveLength(2);
            expect(files.map(f => f.id)).toContain('file-1');
            expect(files.map(f => f.id)).toContain('file-2');
        });
        it('should exclude genesis block', () => {
            const files = blockchain.getAllFiles();
            expect(files).toHaveLength(0);
        });
    });
    describe('replaceChain', () => {
        it('should replace with longer valid chain', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(data);
            const newBlockchain = new blockchain_1.Blockchain();
            newBlockchain.addBlock(data);
            newBlockchain.addBlock({
                ...data,
                file: { ...data.file, id: 'another-file' },
            });
            const result = blockchain.replaceChain(newBlockchain.chain);
            expect(result).toBe(true);
            expect(blockchain.chain).toHaveLength(3);
        });
        it('should not replace with shorter chain', () => {
            const data = {
                type: 'REGISTER',
                file: {
                    id: 'test-file',
                    filename: 'test.txt',
                    originalPath: '/path/to/test.txt',
                    size: 100,
                    hash: 'abc123',
                    uploader: 'tester',
                    timestamp: Date.now(),
                },
            };
            blockchain.addBlock(data);
            const newBlockchain = new blockchain_1.Blockchain();
            const result = blockchain.replaceChain(newBlockchain.chain);
            expect(result).toBe(false);
            expect(blockchain.chain).toHaveLength(2);
        });
    });
});
//# sourceMappingURL=blockchain.test.js.map