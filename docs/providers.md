# Provider Setup Guide

Quorum supports any provider available through the [pi-ai](https://github.com/nichochar/pi-ai) library. This guide covers setup for each supported provider.

## Auto-Detection

The fastest way to get started:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
quorum init
```

Quorum scans environment variables and local services, then configures providers automatically.

## Cloud Providers

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

Get your key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

Config:
```yaml
- name: openai
  provider: openai
  model: gpt-4o  # or gpt-4o-mini, o3-pro, etc.
  auth:
    method: env
    envVar: OPENAI_API_KEY
```

### Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your key at [console.anthropic.com](https://console.anthropic.com).

Config:
```yaml
- name: claude
  provider: anthropic
  model: claude-sonnet-4-20250514
  auth:
    method: env
    envVar: ANTHROPIC_API_KEY
```

**OAuth (Claude Code):** If you use Claude Code with OAuth, Quorum can read the token from macOS Keychain:
```yaml
- name: claude
  provider: anthropic
  model: claude-sonnet-4-20250514
  auth:
    method: oauth_keychain
    service: com.anthropic.claude-code
```

### Google (Gemini)

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=AI...
```

Get your key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Config:
```yaml
- name: gemini
  provider: google
  model: gemini-2.0-flash
  auth:
    method: env
    envVar: GOOGLE_GENERATIVE_AI_API_KEY
```

**Gemini CLI:** If you have Gemini CLI installed, Quorum can detect it automatically.

### Kimi (Moonshot)

```bash
export KIMI_API_KEY=sk-...
```

Get your key at [platform.moonshot.cn](https://platform.moonshot.cn).

Config:
```yaml
- name: kimi
  provider: kimi
  model: moonshot-v1-auto
  auth:
    method: env
    envVar: KIMI_API_KEY
```

### DeepSeek

```bash
export DEEPSEEK_API_KEY=sk-...
```

Get your key at [platform.deepseek.com](https://platform.deepseek.com).

Config:
```yaml
- name: deepseek
  provider: deepseek
  model: deepseek-chat
  auth:
    method: env
    envVar: DEEPSEEK_API_KEY
```

### Mistral

```bash
export MISTRAL_API_KEY=...
```

Get your key at [console.mistral.ai](https://console.mistral.ai).

Config:
```yaml
- name: mistral
  provider: mistral
  model: mistral-large-latest
  auth:
    method: env
    envVar: MISTRAL_API_KEY
```

### Groq

```bash
export GROQ_API_KEY=gsk_...
```

Get your key at [console.groq.com](https://console.groq.com).

Config:
```yaml
- name: groq
  provider: openai
  model: llama-3.3-70b-versatile
  baseUrl: https://api.groq.com/openai/v1
  auth:
    method: env
    envVar: GROQ_API_KEY
```

> **Note:** Groq uses OpenAI-compatible API, so set `provider: openai` with a custom `baseUrl`.

## Local Providers

### Ollama

Install from [ollama.com](https://ollama.com), then:

```bash
ollama pull llama3
```

No API key needed. Quorum auto-detects Ollama at `http://localhost:11434`.

Config:
```yaml
- name: ollama
  provider: ollama
  model: llama3
  auth:
    method: none
```

### LM Studio

Run LM Studio's local server (default: `http://localhost:1234`). Quorum auto-detects it.

Config:
```yaml
- name: lmstudio
  provider: ollama
  model: your-model-name
  baseUrl: http://localhost:1234
  auth:
    method: none
```

## Custom / OpenAI-Compatible

Any OpenAI-compatible API:

```yaml
- name: my-provider
  provider: openai
  model: my-model
  baseUrl: https://my-api.example.com/v1
  auth:
    method: env
    envVar: MY_API_KEY
```

## Managing Providers

```bash
quorum providers list           # show all configured
quorum providers test           # test connectivity
quorum providers models         # browse available models
quorum providers add --name X --type openai --model Y --env Z
quorum providers remove X
```

## Recommended Minimum Setup

For best deliberation quality, configure **at least 3 providers** from different families:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=AI...
quorum init
```

This gives you Claude + GPT + Gemini — three distinct model architectures that produce genuinely diverse perspectives.
