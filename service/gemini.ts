import { encodeBase64 } from 'jsr:@std/encoding/base64'
const TOKEN = Deno.env.get('GEMINI_TOKEN')

export const describeImage = async (imageUrl: string): string => {
  const imageRes = await fetch(imageUrl)
  const imageBuff = await imageRes.arrayBuffer()
  const imageBase64 = encodeBase64(new Uint8Array(imageBuff))
  const prompt = "Write a very concise description of this image for blind peoples, max 20 words, less if possible, be informal and casual. Your answer must start with 'Image of', avoid ponctuation."
  const parts = [
    { text: prompt },
    { inline_data: { mime_type: "image/webp", data: imageBase64 } }
  ]
  const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${TOKEN}`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.4, topK: 32, topP: 1, maxOutputTokens: 4096, stopSequences: [] },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  })
  const output = await geminiRes.json()
  return output.candidates[0].content.parts[0].text
}
