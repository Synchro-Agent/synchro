Logo hãng model / nhà cung cấp hiện trong bộ chọn model, Providers, trang Mức dùng (app/vendorlogo.ts quyết định logo nào, app/brands.tsx vẽ).

Nguồn và giấy phép (giữ nguyên hình, chỉ bỏ width/height="1em" và style để thẻ <img> / mask tự co theo ô):
- simple-icons 16.37.0 (CC0-1.0, https://github.com/simple-icons/simple-icons): meta, mistral, qwen, moonshot (Kimi), perplexity, nvidia,
  openrouter, ollama, replicate, lmstudio, vllm, cloudflare.
- @lobehub/icons-static-svg 1.102.0 (MIT, https://github.com/lobehub/lobe-icons): gemma, microsoft, zhipu (GLM), cohere, together, fireworks,
  stepfun, doubao, hunyuan, baichuan, deepinfra, sambanova, ai2, internlm, wenxin, spark, upstage, minimax, huggingface, novita, siliconcloud,
  hyperbolic, xinference, groq, ai21, ibm, inflection, reka, liquid, lambda, nebius, cerebras, yi.
  Toàn văn giấy phép MIT kèm bản quyền: LICENSE-lobehub.txt (bắt buộc giữ cùng các tệp này).
- Claude, OpenAI, Gemini, Grok, DeepSeek, ElevenLabs vẽ thẳng trong app/brands.tsx (lobehub/icons, MIT).
- public/connectors/composio.svg: dấu hình của Composio, lấy nguyên tệp https://composio.dev/logos/composio-black.svg (dùng để chỉ đúng dịch vụ Composio).
Tên và logo là nhãn hiệu của các hãng; Synchro chỉ dùng để nhận ra model / dịch vụ của hãng đó.
