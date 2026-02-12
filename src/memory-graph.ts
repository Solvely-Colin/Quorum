/**
 * Memory Graph - Cross-run deliberation memory system for Quorum
 * 
 * Stores structured records of deliberations and enables retrieval
 * of relevant prior runs with contradiction detection.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- Types ---

export interface MemoryNode {
  sessionId: string;
  timestamp: number;
  input: string;                    // the original question
  inputKeywords: string[];          // extracted keywords for similarity matching
  profile: string;                  // which agent profile was used
  providers: string[];              // which providers participated
  topology?: string;                // topology used (if any)
  winner: string;                   // vote winner
  synthesizer: string;              // who synthesized
  consensusScore: number;
  confidenceScore: number;
  controversial: boolean;
  decision: string;                 // first 500 chars of synthesis content
  minorityReport?: string;          // first 300 chars
  voteSplit: Record<string, number>; // provider → score from rankings
  tags: string[];                   // auto-extracted topic tags
}

export interface MemoryGraph {
  version: 1;
  nodes: MemoryNode[];
}

// V2ResultLike interface (inline to avoid circular deps)
interface V2ResultLike {
  sessionId: string;
  synthesis: {
    content: string;
    synthesizer: string;
    consensusScore: number;
    confidenceScore: number;
    controversial: boolean;
    minorityReport?: string;
  };
  votes: {
    rankings: Array<{ provider: string; score: number }>;
    winner: string;
  };
  duration: number;
  input?: string;
}

// --- Constants ---

const MEMORY_GRAPH_PATH = path.join(os.homedir(), '.quorum', 'memory-graph.json');

const STOP_WORDS = new Set([
  // Common English stop words
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
  'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
  'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
  'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them',
  'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over',
  'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work',
  'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'was', 'are', 'were', 'been', 'has',
  'had', 'did', 'does', 'doing', 'done', 'being', 'am', 's', 't', 'don',
  'should', 'would', 'could', 'may', 'might', 'must', 'shall', 'can', 'need',
  'dare', 'ought', 'used', 'r', 'm', 've', 'd', 'll', 're',
  // Question words
  'what', 'how', 'should', 'why', 'where', 'when', 'which', 'whom', 'whose',
  'who', 'whether', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  // Common programming filler words
  'using', 'use', 'vs', 'versus', 'between', 'among', 'within', 'without',
  'through', 'during', 'before', 'after', 'above', 'below', 'under', 'over',
  'again', 'further', 'then', 'once', 'here', 'there', 'why', 'how', 'all',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'now'
]);

// Programming languages and frameworks for tag extraction
const TECH_KEYWORDS = new Set([
  // Languages
  'javascript', 'typescript', 'python', 'java', 'go', 'golang', 'rust', 'c++',
  'cpp', 'c', 'csharp', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala',
  'clojure', 'haskell', 'elixir', 'erlang', 'lua', 'perl', 'r', 'matlab',
  'dart', 'flutter', 'julia', 'groovy', 'shell', 'bash', 'powershell',
  'sql', 'html', 'css', 'scss', 'sass', 'less', 'wasm', 'webassembly',
  // Frameworks & Libraries
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'express', 'fastify',
  'nestjs', 'django', 'flask', 'fastapi', 'spring', 'rails', 'laravel',
  'symfony', 'aspnet', 'dotnet', 'blazor', 'electron', 'reactnative',
  'tensorflow', 'pytorch', 'keras', 'scikitlearn', 'pandas', 'numpy',
  'nodejs', 'deno', 'bun',
  // Tools & Platforms
  'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'terraform',
  'ansible', 'jenkins', 'github', 'gitlab', 'bitbucket', 'git', 'npm',
  'yarn', 'pnpm', 'webpack', 'vite', 'rollup', 'parcel', 'esbuild',
  'jest', 'mocha', 'cypress', 'playwright', 'selenium', 'postman',
  'redis', 'mongodb', 'postgres', 'mysql', 'sqlite', 'elasticsearch',
  'kafka', 'rabbitmq', 'graphql', 'rest', 'grpc', 'websocket',
  // Concepts
  'microservices', 'serverless', 'lambda', 'api', 'sdk', 'cli', 'gui',
  'frontend', 'backend', 'fullstack', 'devops', 'ml', 'ai', 'blockchain',
  'crypto', 'auth', 'oauth', 'jwt', 'sso', 'cors', 'csrf', 'xss', 'sqlinjection',
  'testing', 'unittest', 'integration', 'e2e', 'ci', 'cd', 'cicd',
  'agile', 'scrum', 'kanban', 'tdd', 'bdd', 'ddd', 'solid', 'dry', 'kiss',
  'refactoring', 'optimization', 'performance', 'scalability', 'security',
  'architecture', 'designpattern', 'singleton', 'factory', 'observer',
  'mvc', 'mvvm', 'mvp', 'cleanarchitecture', 'hexagonal', 'domaindriven'
]);

// Contradiction indicators
const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'none', 'nothing', 'nobody', 'neither', 'nowhere',
  'hardly', 'scarcely', 'barely', 'don', 'doesn', 'didn', 'wasn', 'weren',
  'haven', 'hasn', 'hadn', 'won', 'wouldn', 'couldn', 'shouldn', 'isn', 'aren'
]);

const POSITIVE_INDICATORS = new Set([
  'recommended', 'recommend', 'best', 'better', 'good', 'great', 'excellent',
  'prefer', 'preferred', 'should use', 'use', 'choose', 'select', 'opt for',
  'ideal', 'optimal', 'superior', 'advantage', 'benefit', 'pros'
]);

const NEGATIVE_INDICATORS = new Set([
  'not recommended', 'avoid', 'don use', 'shouldn use', 'bad', 'worse', 'worst',
  'poor', 'inferior', 'disadvantage', 'drawback', 'cons', 'limitation',
  'problem', 'issue', 'concern', 'risk', 'dangerous', 'unsafe'
]);

// --- Core Functions ---

/**
 * Load memory graph from disk
 * Returns empty graph if file doesn't exist
 */
export async function loadMemoryGraph(): Promise<MemoryGraph> {
  try {
    const data = await fs.readFile(MEMORY_GRAPH_PATH, 'utf-8');
    const graph = JSON.parse(data) as MemoryGraph;
    // Validate structure
    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      return { version: 1, nodes: [] };
    }
    return graph;
  } catch (error) {
    // Return empty graph if file doesn't exist or is corrupted
    return { version: 1, nodes: [] };
  }
}

/**
 * Save memory graph to disk atomically
 * Uses write-temp-then-rename pattern for atomicity
 */
export async function saveMemoryGraph(graph: MemoryGraph): Promise<void> {
  const dir = path.dirname(MEMORY_GRAPH_PATH);
  
  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });
  
  // Write to temp file first
  const tempPath = `${MEMORY_GRAPH_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(graph, null, 2), 'utf-8');
  
  // Atomic rename
  await fs.rename(tempPath, MEMORY_GRAPH_PATH);
}

/**
 * Add a new memory node from a deliberation result
 */
export async function addMemoryNode(result: V2ResultLike): Promise<void> {
  const graph = await loadMemoryGraph();
  
  // Extract vote split from rankings
  const voteSplit: Record<string, number> = {};
  for (const ranking of result.votes.rankings) {
    voteSplit[ranking.provider] = ranking.score;
  }
  
  // Extract providers list
  const providers = result.votes.rankings.map(r => r.provider);
  
  // Create the memory node
  const node: MemoryNode = {
    sessionId: result.sessionId,
    timestamp: Date.now(),
    input: result.input ?? '',
    inputKeywords: extractKeywords(result.input ?? ''),
    profile: 'default', // Will be set by caller or defaulted
    providers,
    winner: result.votes.winner,
    synthesizer: result.synthesis.synthesizer,
    consensusScore: result.synthesis.consensusScore,
    confidenceScore: result.synthesis.confidenceScore,
    controversial: result.synthesis.controversial,
    decision: result.synthesis.content.slice(0, 500),
    minorityReport: result.synthesis.minorityReport?.slice(0, 300),
    voteSplit,
    tags: extractTags(result.synthesis.content)
  };
  
  graph.nodes.push(node);
  
  // Optional: Limit graph size to prevent unbounded growth
  const MAX_NODES = 10000;
  if (graph.nodes.length > MAX_NODES) {
    graph.nodes = graph.nodes.slice(-MAX_NODES);
  }
  
  await saveMemoryGraph(graph);
}

/**
 * Find relevant memories based on keyword similarity
 * Uses recency boost and threshold filtering
 */
export async function findRelevantMemories(
  input: string,
  limit: number = 5
): Promise<MemoryNode[]> {
  const graph = await loadMemoryGraph();
  
  if (graph.nodes.length === 0) {
    return [];
  }
  
  const inputKeywords = extractKeywords(input);
  const inputKeywordSet = new Set(inputKeywords);
  const now = Date.now();
  
  // Score each node
  const scoredNodes = graph.nodes.map(node => {
    const nodeKeywordSet = new Set(node.inputKeywords);
    
    // Calculate keyword overlap
    const matchingKeywords = inputKeywords.filter(kw => nodeKeywordSet.has(kw));
    const totalUniqueKeywords = new Set([...inputKeywords, ...node.inputKeywords]).size;
    
    if (totalUniqueKeywords === 0) {
      return { node, score: 0 };
    }
    
    const baseScore = matchingKeywords.length / totalUniqueKeywords;
    
    // Calculate recency boost (decays over 30 days)
    const ageDays = (now - node.timestamp) / (1000 * 60 * 60 * 24);
    const recencyBoost = 0.2 * Math.exp(-ageDays / 30);
    
    const score = baseScore * (1 + recencyBoost);
    
    return { node, score };
  });
  
  // Filter by threshold and sort by score
  const threshold = 0.15;
  const relevantNodes = scoredNodes
    .filter(item => item.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.node);
  
  return relevantNodes;
}

/**
 * Detect contradictions between current decision and prior memories
 * Returns human-readable contradiction descriptions
 */
export function detectContradictions(
  input: string,
  currentDecision: string,
  memories: MemoryNode[]
): string[] {
  const contradictions: string[] = [];
  
  const currentKeywords = extractKeywords(currentDecision);
  const currentSentiment = analyzeSentiment(currentDecision);
  
  for (const memory of memories) {
    // Check for keyword overlap first
    const memoryKeywords = new Set(memory.inputKeywords);
    const overlap = currentKeywords.filter(kw => memoryKeywords.has(kw));
    
    // Need substantial overlap to consider contradiction
    if (overlap.length < 2) {
      continue;
    }
    
    // Analyze sentiment of prior decision
    const priorSentiment = analyzeSentiment(memory.decision);
    
    // Check for sentiment contradictions
    if (currentSentiment && priorSentiment) {
      if (currentSentiment !== priorSentiment) {
        const date = new Date(memory.timestamp).toISOString().split('T')[0];
        contradictions.push(
          `On ${date}, the council concluded "${truncate(memory.decision, 80)}", ` +
          `but now concludes "${truncate(currentDecision, 80)}"`
        );
        continue;
      }
    }
    
    // Check for specific recommendation contradictions
    const currentRec = extractRecommendation(currentDecision);
    const priorRec = extractRecommendation(memory.decision);
    
    if (currentRec && priorRec && currentRec !== priorRec) {
      const date = new Date(memory.timestamp).toISOString().split('T')[0];
      contradictions.push(
        `On ${date}, the council recommended "${priorRec}", ` +
        `but now recommends "${currentRec}"`
      );
    }
  }
  
  return contradictions;
}

/**
 * Extract meaningful keywords from text
 * Removes stop words, lowercases, deduplicates
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];
  
  // Normalize text
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .replace(/\s+/g, ' ')       // Collapse whitespace
    .trim();
  
  // Split into words and filter
  const words = normalized.split(' ');
  const keywords = words
    .filter(word => word.length >= 2)           // Skip very short words
    .filter(word => !STOP_WORDS.has(word))      // Remove stop words
    .filter(word => !/^\d+$/.test(word));       // Remove pure numbers
  
  // Deduplicate while preserving order
  return [...new Set(keywords)];
}

/**
 * Extract topic tags from text
 * Focuses on programming languages, frameworks, and concepts
 */
export function extractTags(text: string): string[] {
  if (!text) return [];
  
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const words = normalized.split(' ');
  const tags: string[] = [];
  
  for (const word of words) {
    if (TECH_KEYWORDS.has(word)) {
      tags.push(word);
    }
  }
  
  // Also check for multi-word matches
  const textWithoutPunctuation = normalized;
  for (const keyword of TECH_KEYWORDS) {
    if (keyword.includes(' ') && textWithoutPunctuation.includes(keyword)) {
      tags.push(keyword);
    }
  }
  
  // Deduplicate
  return [...new Set(tags)];
}

/**
 * Format relevant memories as context string for injection into gather phase
 */
export function formatMemoryContext(memories: MemoryNode[]): string {
  if (memories.length === 0) {
    return '';
  }
  
  const lines: string[] = ['## Prior Deliberations', ''];
  
  for (const memory of memories) {
    const date = new Date(memory.timestamp).toISOString().split('T')[0];
    lines.push(`### ${date} - ${memory.sessionId.slice(0, 8)}`);
    lines.push(`**Question:** ${memory.input || '(not recorded)'}`);
    lines.push(`**Decision:** ${memory.decision}`);
    lines.push(`**Winner:** ${memory.winner} | **Consensus:** ${(memory.consensusScore * 100).toFixed(0)}% | **Confidence:** ${(memory.confidenceScore * 100).toFixed(0)}%`);
    
    if (memory.tags.length > 0) {
      lines.push(`**Tags:** ${memory.tags.join(', ')}`);
    }
    
    if (memory.minorityReport) {
      lines.push(`**Minority View:** ${memory.minorityReport}`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

// --- Helper Functions ---

function analyzeSentiment(text: string): 'positive' | 'negative' | null {
  const normalized = text.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const indicator of POSITIVE_INDICATORS) {
    if (normalized.includes(indicator)) {
      positiveCount++;
    }
  }
  
  for (const indicator of NEGATIVE_INDICATORS) {
    if (normalized.includes(indicator)) {
      negativeCount++;
    }
  }
  
  // Check for negation flipping
  for (const negWord of NEGATION_WORDS) {
    const negPattern = new RegExp(`\\b${negWord}\\b`, 'gi');
    const negMatches = normalized.match(negPattern);
    if (negMatches) {
      // Simple heuristic: negation flips sentiment
      const temp = positiveCount;
      positiveCount = negativeCount;
      negativeCount = temp;
      break;
    }
  }
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return null;
}

function extractRecommendation(text: string): string | null {
  // Look for "use X" or "choose X" patterns
  const patterns = [
    /(?:use|choose|select|opt for|go with|pick)\s+([\w\s]+?)(?:\.|,|;|$)/i,
    /(?:recommended|suggest)\s+(?:using|choosing)?\s*([\w\s]+?)(?:\.|,|;|$)/i,
    /(?:best|ideal|optimal)\s+(?:option|choice|solution)\s+(?:is)?\s*:?\s*([\w\s]+?)(?:\.|,|;|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().slice(0, 50);
    }
  }
  
  return null;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Clear the memory graph (delete all memories)
 */
export async function clearMemoryGraph(): Promise<void> {
  await saveMemoryGraph({ version: 1, nodes: [] });
}
