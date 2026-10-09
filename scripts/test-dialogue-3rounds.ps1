# Prompt 2 对话链路 5 轮真实测试（模拟前端请求序列）
# 流程：初答 + 4 次追问（第 4 次为总结性问题）+ 总结轮
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$body_common = @{
  articleTitle = "延迟满足与长期主义"
  articleSummary = "延迟满足是一种放弃即时奖励以获取更大未来收益的能力，与长期主义思维密切相关。"
  articleKeyPoints = @("延迟满足是可训练的能力", "长期主义需要反馈机制支撑")
  questionText = "延迟满足在你的生活中有哪些具体体现？你认为在当今社会，延迟满足是变得更难了还是更重要了？"
  dimension = "联想力"
  firstAnswer = "我觉得延迟满足很重要。文章说的道理在理财上也能看到，比如定投基金比冲动消费好。不过我也觉得不能什么都延迟，有时候需要即时满足来保持动力。"
  checkInDays = 3
}

$rounds = @(
  @{ msg = "举个例子的话，我大学时攒了半年钱买了一台相机，当时很想要但忍住了，后来买的时候特别开心。" },
  @{ msg = "坚持的动力一方面是确实需要，另一方面是看到账户数字增长的成就感。" },
  @{ msg = "如果数字不涨我可能会动摇，不过定投本来就看长期，短期波动只能接受。" },
  @{ msg = "最重要的收获是明白了延迟满足不是硬忍，而是把注意力放在过程本身，让坚持变成习惯。" },
  @{ msg = "总结一下的话，延迟满足最核心的启示是：真正的坚持靠的不是意志力硬扛，而是把大目标拆进日常习惯里。" }
)

$history = @()
$results = @()

for ($i = 0; $i -lt 5; $i++) {
  $body = @{
    message = $rounds[$i].msg
    dialogueHistory = $history
  }
  foreach ($k in $body_common.Keys) { $body[$k] = $body_common[$k] }

  $json = $body | ConvertTo-Json -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $r = Invoke-WebRequest -Uri "http://localhost:3000/api/chat" -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes -UseBasicParsing -TimeoutSec 120
  $raw = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding("ISO-8859-1").GetBytes($r.Content))
  $data = ($raw | ConvertFrom-Json).data

  $results += [PSCustomObject]@{
    round = $i + 1
    acknowledge = $data.acknowledge
    followUpQuestion = $data.followUpQuestion
    isFinalRound = $data.isFinalRound
    thoughtFlow = $data.thoughtFlow
    articleScores = $data.articleScores
    articleComment = $data.articleComment
    guideToThinkingGuide = $data.guideToThinkingGuide
  }

  # 模拟前端：历史累积（assistant 存 reply）
  $history += @{ role = "user"; content = $rounds[$i].msg }
  $history += @{ role = "assistant"; content = $data.reply }
}

$out = $results | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText("$env:TEMP\dialogue_test_result.json", $out, [System.Text.Encoding]::UTF8)
Write-Host "done - 5 AI calls completed (3 follow-ups + summary question + summary round)"
