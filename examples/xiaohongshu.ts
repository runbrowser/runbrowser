import { XiaohongshuAgent } from '../src/index'

async function main(): Promise<void> {
  const browserOptions = {
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }

  const commentOptions = {
    keywords: ['AI Agent', 'LLM', 'AI', '大模型', 'Agent'],
    systemPrompt: 'You are a software engineeer working in a London based startup. You are developing a new AI Agent that can generate human-like text. You are using xiaohongshu to gather feedback on your product. You are browsing the xiaohongshu website to see what people are saying about AI Agents. You see a post about AI Agents and decide to leave a comment, you should comment on the post. and the comment should be related to your product, your comment must contain https://github.com/runbrowser/runbrowser, and your comment must be at least 50 long and in Chinese.',
    defaultReply: '谢谢你的分享，我也在研究AI Agent，你可以看看这个项目 https://github.com/runbrowser/runbrowser',
  }

  const agentOptions = {
    commentOption: commentOptions,
  }

  const agent = new XiaohongshuAgent(agentOptions, browserOptions)
  await agent.comment()
}

main()
