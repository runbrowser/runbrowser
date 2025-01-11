import { XiaohongshuAgent } from '../src/index'

async function main(): Promise<void> {
  const browserOptions = {
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }
  //   const llm = 'deepseek'
  //   const keywords = ['AI Agent', 'LLM', 'AI', '大模型', 'Agent']
  //   const commentPrompt = 'AI Agent is a large language model that can generate human-like text. It is trained on a diverse range of internet text and can generate text on a wide range of topics. It is capable of writing essays, answering questions, and even generating code. It is a powerful tool that can be used for a wide range of applications, from content generation to chatbots to code generation. It is a cutting-edge technology that is revolutionizing the field of natural language processing.'
  const agent = new XiaohongshuAgent(browserOptions)

  await agent.run()
}

main()
