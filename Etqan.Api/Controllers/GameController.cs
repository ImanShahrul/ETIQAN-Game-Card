using Etqan.Api.Models;
using Etqan.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Etqan.Api.Controllers;

[ApiController]
[Route("api/game")]
public sealed class GameController(SqlGameStore store) : ControllerBase
{
    private static readonly string[] Letters = ["E", "T", "I", "Q", "A", "N"];

    [HttpPost("register-player")]
    public async Task<ActionResult<PlayerRegistrationResponse>> RegisterPlayer(
        [FromBody] PlayerRegistrationRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Uid))
            return BadRequest("Player name and session ID are required.");

        return Ok(await store.RegisterPlayerAsync(request.Name.Trim(), request.Uid.Trim(), cancellationToken));
    }

    [HttpGet("questions")]
    public async Task<ActionResult<IReadOnlyList<QuestionResponse>>> GetQuestions(CancellationToken cancellationToken) =>
        Ok(await store.GetQuestionsAsync(cancellationToken));

    [HttpGet("cards/{uid}")]
    public async Task<ActionResult<IReadOnlyList<CardCellRequest>>> GetCard(string uid, CancellationToken cancellationToken)
    {
        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var cells = await store.GetCardAsync(uid, round.Id, cancellationToken);
        if (cells is null || cells.Count != 36) return NotFound();
        return Ok(cells);
    }

    [HttpPost("cards/generate")]
    public async Task<ActionResult<IReadOnlyList<CardCellRequest>>> GenerateCard(
        [FromBody] GenerateCardRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Uid)) return BadRequest("Session ID is required.");
        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var questions = await store.GetQuestionsAsync(cancellationToken);
        var missingLetter = Letters.FirstOrDefault(letter => questions.Count(question => string.Equals(question.Letter, letter, StringComparison.OrdinalIgnoreCase)) < 6);
        if (missingLetter is not null)
            return Conflict($"At least 6 active questions are required for letter {missingLetter}.");

        return Ok(await store.GenerateCardAsync(request.Uid.Trim(), round.Id, cancellationToken));
    }

    [HttpPut("cards/{uid}")]
    public async Task<ActionResult> SaveCard(
        string uid,
        [FromBody] SaveCardRequest request,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(uid, request.Uid, StringComparison.Ordinal))
            return BadRequest("Card session ID does not match the route.");

        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");
        var cells = await store.GetCardAsync(uid, round.Id, cancellationToken);
        return cells is null ? NotFound() : NoContent();
    }

    [HttpPost("cards/{uid}/answer")]
    public async Task<ActionResult<AnswerResponse>> SubmitAnswer(
        string uid,
        [FromBody] AnswerRequest request,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(uid, request.Uid, StringComparison.Ordinal))
            return BadRequest("Card session ID does not match the route.");
        if (string.IsNullOrWhiteSpace(request.Option) || !"ABCD".Contains(request.Option.Trim().ToUpperInvariant()))
            return BadRequest("A valid answer option is required.");

        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var result = await store.SubmitAnswerAsync(uid, request.CellIndex, request.Option, round.Id, cancellationToken);
        if (!result.Found) return NotFound("The ETIQAN card has not been generated.");
        if (result.AlreadyAnswered) return Conflict("This question has already been answered.");
        return Ok(new AnswerResponse(result.Correct, request.CellIndex, result.Cells));
    }

    [HttpPost("cards/{uid}/retry")]
    public async Task<ActionResult<IReadOnlyList<CardCellRequest>>> RetryQuestion(
        string uid,
        [FromBody] RetryRequest request,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(uid, request.Uid, StringComparison.Ordinal))
            return BadRequest("Card session ID does not match the route.");

        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var result = await store.RetryQuestionAsync(uid, request.CellIndex, round.Id, cancellationToken);
        if (!result.Found) return NotFound("The ETIQAN card has not been generated.");
        if (!result.CanRetry) return Conflict("There are no unused replacement questions for this ETIQAN letter.");
        return Ok(result.Cells);
    }

    [HttpPost("presence/{uid}")]
    public async Task<ActionResult> TouchPresence(string uid, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(uid)) return BadRequest("Session ID is required.");
        return await store.TouchPlayerAsync(uid.Trim(), cancellationToken) ? NoContent() : NotFound();
    }

    [HttpGet("sidebar/{uid}")]
    public async Task<ActionResult<GameSidebarResponse>> GetSidebar(string uid, CancellationToken cancellationToken)
    {
        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var result = await store.GetSidebarAsync(uid, round.Id, cancellationToken);
        return Ok(new GameSidebarResponse(result.Radar, result.WinnerSlots, result.ActivePlayerCount));
    }

    [HttpPost("check-winning-condition")]
    public ActionResult<WinningConditionResponse> CheckWinningCondition([FromBody] WinningConditionRequest request)
    {
        if (request.CompletedCells.Length != 36)
            return BadRequest("A 6x6 ETIQAN card requires exactly 36 cells.");

        var lines = new List<string>();
        for (var row = 0; row < 6; row++)
            if (Enumerable.Range(0, 6).All(column => request.CompletedCells[row * 6 + column])) lines.Add($"Row {row + 1}");
        for (var column = 0; column < 6; column++)
            if (Enumerable.Range(0, 6).All(row => request.CompletedCells[row * 6 + column])) lines.Add($"Column {Letters[column]}");
        if (Enumerable.Range(0, 6).All(index => request.CompletedCells[index * 6 + index])) lines.Add("Diagonal (\\)");
        if (Enumerable.Range(0, 6).All(index => request.CompletedCells[index * 6 + (5 - index)])) lines.Add("Diagonal (/)");

        return Ok(new WinningConditionResponse(lines.Count > 0, lines, lines.Count));
    }

    [HttpPost("winners")]
    public async Task<ActionResult<WinnerResponse>> SaveWinner(
        [FromBody] WinnerRequest request,
        CancellationToken cancellationToken)
    {
        if (request.CompletedCells.Count != 36)
            return BadRequest("A 6x6 ETIQAN card requires exactly 36 cells.");

        var round = await store.GetCurrentRoundAsync(cancellationToken);
        if (round is null) return Conflict("No active ETIQAN round is configured in SQL Server.");

        var result = await store.SaveWinnerAsync(request, round.Id, cancellationToken);
        if (result is null) return Conflict("The player card was not found in the active ETIQAN round.");
        return Ok(new WinnerResponse(result.WinnerId.ToString(), result.WinnerType, result.PlayerName));
    }
}

public sealed record WinningConditionRequest(bool[] CompletedCells);
public sealed record WinningConditionResponse(bool HasBingo, IReadOnlyList<string> Patterns, int BingoCount);
