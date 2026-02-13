/**
 * Lightweight tool-use system for provider responses during gather phase.
 * Providers can invoke tools using <tool:name>input</tool:name> syntax.
 */

import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ToolResult {
  tool: string;
  input: string;
  output: string;
}

export interface ToolOptions {
  allowShell?: boolean;
}

const TOOL_REGEX = /<tool:(web_search|read_file|shell)>([\s\S]*?)<\/tool:\1>/g;
const MAX_INVOCATIONS = 3;

async function runWebSearch(query: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(query);
    const { stdout } = await execFileAsync(
      'curl',
      ['-s', '-L', '--max-time', '10', `https://lite.duckduckgo.com/lite?q=${encoded}`],
      { timeout: 15000 },
    );
    // Strip HTML tags and extract text
    const text = stdout
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 2000);
  } catch (err) {
    return `[web_search error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function runReadFile(input: string): Promise<string> {
  try {
    const cwd = process.cwd();
    const resolved = resolve(cwd, input.trim());
    if (!resolved.startsWith(cwd)) {
      return '[read_file error: path traversal not allowed]';
    }
    const content = await readFile(resolved, 'utf-8');
    if (content.length > 50 * 1024) {
      return content.slice(0, 50 * 1024) + '\n[truncated at 50KB]';
    }
    return content;
  } catch (err) {
    return `[read_file error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function runShell(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command.trim()], {
      timeout: 10000,
      maxBuffer: 5 * 1024,
    });
    const output = (stdout + (stderr ? '\n' + stderr : '')).trim();
    return output.slice(0, 5 * 1024);
  } catch (err) {
    return `[shell error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export async function executeTools(
  response: string,
  options: ToolOptions = {},
): Promise<{ cleanedResponse: string; toolResults: ToolResult[] }> {
  const toolResults: ToolResult[] = [];
  const matches: Array<{ full: string; tool: string; input: string }> = [];

  let match: RegExpExecArray | null;
  const regex = new RegExp(TOOL_REGEX.source, 'g');
  while ((match = regex.exec(response)) !== null && matches.length < MAX_INVOCATIONS) {
    matches.push({ full: match[0], tool: match[1], input: match[2] });
  }

  let cleanedResponse = response;

  for (const m of matches) {
    let output: string;
    switch (m.tool) {
      case 'web_search':
        output = await runWebSearch(m.input);
        break;
      case 'read_file':
        output = await runReadFile(m.input);
        break;
      case 'shell':
        if (!options.allowShell) {
          output = '[shell tool is disabled]';
        } else {
          output = await runShell(m.input);
        }
        break;
      default:
        output = `[unknown tool: ${m.tool}]`;
    }

    toolResults.push({ tool: m.tool, input: m.input.trim(), output });
    cleanedResponse = cleanedResponse.replace(m.full, `[Tool ${m.tool}: ${output.slice(0, 500)}]`);
  }

  return { cleanedResponse, toolResults };
}
