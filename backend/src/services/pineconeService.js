import { Pinecone } from '@pinecone-database/pinecone';
import { pipeline } from '@xenova/transformers';
import dotenv from 'dotenv';

dotenv.config();

let pineconeClient = null;
let index = null;

// Stores the Promise itself so concurrent calls all await the same load
// instead of each starting their own model load in parallel.
let embedderPromise = null;

// Initialize Pinecone
export async function initializePinecone() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    index = pineconeClient.index(process.env.PINECONE_INDEX_NAME);
    console.log('✅ Pinecone initialized');
  }
  return index;
}

// Initialize the embedding model (runs locally, no API key needed)
function getEmbedder() {
  if (!embedderPromise) {
    console.log('🔄 Loading embedding model (first time may take a minute)...');
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      .then(model => { console.log('✅ Embedding model loaded'); return model; })
      .catch(err => {
        embedderPromise = null; // allow retry on next request
        throw err;
      });
  }
  return embedderPromise;
}

// Generate embeddings locally
async function generateEmbedding(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Search knowledge base
export async function searchKnowledgeBase(query, topK = 5) {
  try {
    await initializePinecone();

    const queryEmbedding = await generateEmbedding(query);

    const searchResponse = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    console.log(`🔍 Found ${searchResponse.matches.length} relevant documents`);

    return searchResponse.matches.map(match => ({
      text: match.metadata?.text || '',
      score: match.score,
      source: match.metadata?.source || 'knowledge-base',
    }));
  } catch (error) {
    console.error('❌ Error searching knowledge base:', error);
    return [];
  }
}

// Batch index documents
export async function batchIndexDocuments(documents) {
  try {
    await initializePinecone();

    console.log(`📚 Indexing ${documents.length} documents...`);

    const vectors = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      console.log(`  Generating embedding for document ${i + 1}/${documents.length}...`);

      const embedding = await generateEmbedding(doc.text);

      vectors.push({
        id: `doc-${Date.now()}-${i}`,
        values: embedding,
        metadata: {
          text: doc.text,
          source: doc.metadata?.source || 'knowledge-base',
        },
      });
    }

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(batch);
      console.log(`✅ Indexed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
    }

    console.log('✅ All documents indexed successfully');
    return vectors.length;
  } catch (error) {
    console.error('❌ Error batch indexing documents:', error);
    throw error;
  }
}

// Index a single document
export async function indexDocument(text, metadata = {}) {
  return batchIndexDocuments([{ text, metadata }]);
}
