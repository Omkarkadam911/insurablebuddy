import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { batchIndexDocuments } from '../services/pineconeService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to read text/markdown files from a directory
function readKnowledgeFiles(directoryPath) {
  const documents = [];
  const files = fs.readdirSync(directoryPath);

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Split into chunks if content is too long (more than 1000 characters)
      const chunks = chunkText(content, 1000);

      chunks.forEach((chunk, idx) => {
        documents.push({
          text: chunk,
          metadata: {
            source: file,
            chunk: idx,
          },
        });
      });

      console.log(`✅ Read file: ${file} (${chunks.length} chunks)`);
    }
  }

  return documents;
}

// Split text into chunks
function chunkText(text, maxLength) {
  const chunks = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

// Main indexing function
async function main() {
  try {
    const knowledgePath = path.join(__dirname, '../../knowledge');

    if (!fs.existsSync(knowledgePath)) {
      console.log(`📁 Creating knowledge directory at: ${knowledgePath}`);
      fs.mkdirSync(knowledgePath, { recursive: true });
      console.log('⚠️  Please add your knowledge base files (txt or md) to the knowledge directory and run this script again.');
      return;
    }

    console.log('📚 Reading knowledge base files...');
    const documents = readKnowledgeFiles(knowledgePath);

    if (documents.length === 0) {
      console.log('⚠️  No documents found. Please add .txt or .md files to the knowledge directory.');
      return;
    }

    console.log(`\n📊 Found ${documents.length} document chunks to index`);
    console.log('🚀 Starting indexing process...\n');

    await batchIndexDocuments(documents);

    console.log('\n✅ Knowledge base indexing completed successfully!');
  } catch (error) {
    console.error('❌ Error indexing knowledge base:', error);
    process.exit(1);
  }
}

main();
