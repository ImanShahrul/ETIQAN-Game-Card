using System.Data;
using Etqan.Api.Models;
using Microsoft.Data.SqlClient;

namespace Etqan.Api.Services;

public sealed record SqlRound(int Id, string Name);
public sealed record SqlAnswerResult(bool Found, bool AlreadyAnswered, bool Correct, IReadOnlyList<CardCellRequest> Cells);
public sealed record SqlRetryResult(bool Found, bool CanRetry, IReadOnlyList<CardCellRequest> Cells);
public sealed record SqlWinnerResult(int WinnerId, string WinnerType, string PlayerName);
public sealed record SqlSidebarResult(IReadOnlyList<RadarEntry> Radar, IReadOnlyList<WinnerSlotResponse> WinnerSlots, int ActivePlayerCount);

public sealed class SqlGameStore(IConfiguration configuration)
{
    private static readonly string[] Letters = ["E", "T", "I", "Q", "A", "N"];
    private readonly string _connectionString = configuration.GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");

    public async Task<SqlRound?> GetCurrentRoundAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("""
            SELECT TOP (1) RoundId, RoundName
            FROM dbo.GameRounds
            WHERE Status = 'Active'
            ORDER BY RoundId DESC;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new SqlRound(reader.GetInt32(0), reader.GetString(1))
            : null;
    }

    public async Task<PlayerRegistrationResponse> RegisterPlayerAsync(string name, string uid, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var find = new SqlCommand("SELECT TOP (1) PlayerId FROM dbo.Players WHERE ExternalUid = @uid;", connection, (SqlTransaction)transaction);
        find.Parameters.AddWithValue("@uid", uid);
        var existing = await find.ExecuteScalarAsync(cancellationToken);

        int playerId;
        if (existing is not null && existing is not DBNull)
        {
            playerId = Convert.ToInt32(existing);
            await using var update = new SqlCommand("""
                UPDATE dbo.Players
                SET Name = @name, Status = 'Active', LastLoginAt = SYSUTCDATETIME(), LastSeenAt = SYSUTCDATETIME()
                WHERE PlayerId = @playerId;
                """, connection, (SqlTransaction)transaction);
            update.Parameters.AddWithValue("@name", name);
            update.Parameters.AddWithValue("@playerId", playerId);
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            await using var insert = new SqlCommand("""
                INSERT INTO dbo.Players (Name, ExternalUid, Status, CreatedAt, LastLoginAt, LastSeenAt)
                OUTPUT INSERTED.PlayerId
                VALUES (@name, @uid, 'Active', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
                """, connection, (SqlTransaction)transaction);
            insert.Parameters.AddWithValue("@name", name);
            insert.Parameters.AddWithValue("@uid", uid);
            playerId = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken));
        }

        await transaction.CommitAsync(cancellationToken);
        return new PlayerRegistrationResponse(playerId.ToString(), uid, name);
    }

    public async Task<IReadOnlyList<QuestionResponse>> GetQuestionsAsync(CancellationToken cancellationToken)
    {
        var questions = new List<QuestionResponse>();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("""
            SELECT QuestionId, Letter, Category, QuestionText, OptionA, OptionB, OptionC, OptionD, CorrectOption,
                   ROW_NUMBER() OVER (PARTITION BY Letter ORDER BY QuestionId) - 1 AS LetterRow
            FROM dbo.Questions
            WHERE IsActive = 1
            ORDER BY Letter, QuestionId;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = Convert.ToInt32(reader.GetInt64(9));
            var id = reader.GetInt32(0);
            var correctOption = reader.GetString(8).Trim();
            var optionA = reader.GetString(4);
            var optionB = reader.GetString(5);
            var optionC = reader.GetString(6);
            var optionD = reader.IsDBNull(7) ? string.Empty : reader.GetString(7);
            questions.Add(new QuestionResponse(
                id.ToString(),
                reader.GetString(1).Trim(),
                row,
                id,
                row,
                reader.GetString(3),
                reader.GetString(2),
                optionA,
                optionB,
                optionC,
                optionD,
                correctOption,
                OptionText(correctOption, optionA, optionB, optionC, optionD)));
        }
        return questions;
    }

    public async Task<IReadOnlyList<CardCellRequest>?> GetCardAsync(string uid, int roundId, CancellationToken cancellationToken)
    {
        var cells = new List<CardCellRequest>();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(CardQuery, connection);
        command.Parameters.AddWithValue("@uid", uid);
        command.Parameters.AddWithValue("@roundId", roundId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            cells.Add(ReadCardCell(reader));

        return cells.Count == 0 ? null : cells;
    }

    public async Task<IReadOnlyList<CardCellRequest>> GenerateCardAsync(string uid, int roundId, CancellationToken cancellationToken)
    {
        var questions = await GetQuestionsAsync(cancellationToken);
        var selected = new List<(QuestionResponse Question, int Position)>();
        foreach (var letter in Letters)
        {
            var letterQuestions = questions
                .Where(question => string.Equals(question.Letter, letter, StringComparison.OrdinalIgnoreCase))
                .OrderBy(_ => Random.Shared.Next())
                .Take(6)
                .ToArray();
            if (letterQuestions.Length < 6)
                throw new InvalidOperationException($"At least 6 active questions are required for letter {letter}.");
            selected.AddRange(letterQuestions.Select((question, index) => (question, index + 1)));
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        await using var cardCommand = new SqlCommand("""
            INSERT INTO dbo.Cards (PlayerId, RoundId, IsLocked, CreatedAt)
            SELECT PlayerId, @roundId, 0, SYSUTCDATETIME()
            FROM dbo.Players
            WHERE ExternalUid = @uid;
            SELECT CAST(SCOPE_IDENTITY() AS int);
            """, connection, (SqlTransaction)transaction);
        cardCommand.Parameters.AddWithValue("@roundId", roundId);
        cardCommand.Parameters.AddWithValue("@uid", uid);
        var cardIdValue = await cardCommand.ExecuteScalarAsync(cancellationToken);
        if (cardIdValue is null or DBNull)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new InvalidOperationException("The player session was not found in SQL Server.");
        }
        var cardId = Convert.ToInt32(cardIdValue);

        foreach (var group in selected.GroupBy(item => item.Question.Letter, StringComparer.OrdinalIgnoreCase))
        {
            foreach (var item in group)
            {
                await using var cellCommand = new SqlCommand("""
                    INSERT INTO dbo.CardQuestions (CardId, QuestionId, Letter, Position, Status)
                    VALUES (@cardId, @questionId, @letter, @position, 'Pending');
                    """, connection, (SqlTransaction)transaction);
                cellCommand.Parameters.AddWithValue("@cardId", cardId);
                cellCommand.Parameters.AddWithValue("@questionId", int.Parse(item.Question.Id));
                cellCommand.Parameters.AddWithValue("@letter", item.Question.Letter);
                cellCommand.Parameters.AddWithValue("@position", item.Position);
                await cellCommand.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return await GetCardAsync(uid, roundId, cancellationToken) ?? [];
    }

    public async Task<bool> TouchPlayerAsync(string uid, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("""
            UPDATE dbo.Players
            SET LastSeenAt = SYSUTCDATETIME(), Status = 'Active'
            WHERE ExternalUid = @uid;
            """, connection);
        command.Parameters.AddWithValue("@uid", uid);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<SqlAnswerResult> SubmitAnswerAsync(string uid, int cellIndex, string option, int roundId, CancellationToken cancellationToken)
    {
        if (cellIndex is < 0 or >= 36) return new SqlAnswerResult(false, false, false, []);
        var letter = Letters[cellIndex % 6];
        var position = cellIndex / 6 + 1;

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction(IsolationLevel.Serializable);
        await using var find = new SqlCommand("""
            SELECT TOP (1) c.CardId, cq.CardQuestionId, cq.Status, q.CorrectOption
            FROM dbo.Cards c WITH (UPDLOCK, ROWLOCK)
            JOIN dbo.Players p ON p.PlayerId = c.PlayerId
            JOIN dbo.CardQuestions cq ON cq.CardId = c.CardId
            JOIN dbo.Questions q ON q.QuestionId = cq.QuestionId
            WHERE p.ExternalUid = @uid AND c.RoundId = @roundId AND cq.Letter = @letter AND cq.Position = @position
            ORDER BY c.CardId DESC;
            """, connection, transaction);
        find.Parameters.AddWithValue("@uid", uid);
        find.Parameters.AddWithValue("@roundId", roundId);
        find.Parameters.AddWithValue("@letter", letter);
        find.Parameters.AddWithValue("@position", position);

        int cardQuestionId;
        string status;
        string correctOption;
        await using (var reader = await find.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                transaction.Rollback();
                return new SqlAnswerResult(false, false, false, []);
            }
            cardQuestionId = reader.GetInt32(1);
            status = reader.GetString(2);
            correctOption = reader.GetString(3).Trim();
        }

        if (!string.Equals(status, "Pending", StringComparison.OrdinalIgnoreCase))
        {
            transaction.Rollback();
            var current = await GetCardAsync(uid, roundId, cancellationToken) ?? [];
            return new SqlAnswerResult(true, true, string.Equals(status, "Correct", StringComparison.OrdinalIgnoreCase), current);
        }

        var selectedOption = option.Trim().ToUpperInvariant();
        var correct = string.Equals(correctOption, selectedOption, StringComparison.OrdinalIgnoreCase);
        await using var answer = new SqlCommand("""
            INSERT INTO dbo.Answers (CardQuestionId, SelectedOption, IsCorrect, AnsweredAt)
            VALUES (@cardQuestionId, @selectedOption, @isCorrect, SYSUTCDATETIME());
            UPDATE dbo.CardQuestions
            SET Status = @status
            WHERE CardQuestionId = @cardQuestionId;
            """, connection, transaction);
        answer.Parameters.AddWithValue("@cardQuestionId", cardQuestionId);
        answer.Parameters.AddWithValue("@selectedOption", selectedOption);
        answer.Parameters.AddWithValue("@isCorrect", correct);
        answer.Parameters.AddWithValue("@status", correct ? "Correct" : "Eliminated");
        await answer.ExecuteNonQueryAsync(cancellationToken);
        transaction.Commit();

        var cells = await GetCardAsync(uid, roundId, cancellationToken) ?? [];
        return new SqlAnswerResult(true, false, correct, cells);
    }

    public async Task<SqlRetryResult> RetryQuestionAsync(string uid, int cellIndex, int roundId, CancellationToken cancellationToken)
    {
        if (cellIndex is < 0 or >= 36) return new SqlRetryResult(false, false, []);
        var letter = Letters[cellIndex % 6];
        var position = cellIndex / 6 + 1;

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction(IsolationLevel.Serializable);
        await using var find = new SqlCommand("""
            SELECT TOP (1) c.CardId, cq.CardQuestionId, cq.Status
            FROM dbo.Cards c WITH (UPDLOCK, ROWLOCK)
            JOIN dbo.Players p ON p.PlayerId = c.PlayerId
            JOIN dbo.CardQuestions cq ON cq.CardId = c.CardId
            WHERE p.ExternalUid = @uid AND c.RoundId = @roundId AND cq.Letter = @letter AND cq.Position = @position
            ORDER BY c.CardId DESC;
            """, connection, transaction);
        find.Parameters.AddWithValue("@uid", uid);
        find.Parameters.AddWithValue("@roundId", roundId);
        find.Parameters.AddWithValue("@letter", letter);
        find.Parameters.AddWithValue("@position", position);

        int cardId;
        int cardQuestionId;
        string status;
        await using (var reader = await find.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                transaction.Rollback();
                return new SqlRetryResult(false, false, []);
            }
            cardId = reader.GetInt32(0);
            cardQuestionId = reader.GetInt32(1);
            status = reader.GetString(2);
        }

        if (!string.Equals(status, "Eliminated", StringComparison.OrdinalIgnoreCase))
        {
            transaction.Rollback();
            return new SqlRetryResult(true, false, await GetCardAsync(uid, roundId, cancellationToken) ?? []);
        }

        await using var replacement = new SqlCommand("""
            SELECT TOP (1) QuestionId
            FROM dbo.Questions q
            WHERE q.Letter = @letter
              AND q.IsActive = 1
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.CardQuestions used
                  WHERE used.CardId = @cardId AND used.QuestionId = q.QuestionId
              )
            ORDER BY NEWID();
            """, connection, transaction);
        replacement.Parameters.AddWithValue("@letter", letter);
        replacement.Parameters.AddWithValue("@cardId", cardId);
        var questionId = await replacement.ExecuteScalarAsync(cancellationToken);
        if (questionId is null or DBNull)
        {
            transaction.Rollback();
            return new SqlRetryResult(true, false, await GetCardAsync(uid, roundId, cancellationToken) ?? []);
        }

        await using var update = new SqlCommand("""
            UPDATE dbo.CardQuestions
            SET QuestionId = @questionId, Status = 'Pending'
            WHERE CardQuestionId = @cardQuestionId;
            """, connection, transaction);
        update.Parameters.AddWithValue("@questionId", Convert.ToInt32(questionId));
        update.Parameters.AddWithValue("@cardQuestionId", cardQuestionId);
        await update.ExecuteNonQueryAsync(cancellationToken);
        transaction.Commit();

        return new SqlRetryResult(true, true, await GetCardAsync(uid, roundId, cancellationToken) ?? []);
    }

    public async Task<SqlSidebarResult> GetSidebarAsync(string currentUid, int roundId, CancellationToken cancellationToken)
    {
        var activePlayerCount = 0;
        await using var connection = await OpenConnectionAsync(cancellationToken);

        await using (var count = new SqlCommand("""
            SELECT COUNT(*)
            FROM dbo.Players
            WHERE LastSeenAt IS NOT NULL AND LastSeenAt >= DATEADD(MINUTE, -5, SYSUTCDATETIME());
            """, connection))
        {
            activePlayerCount = Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken));
        }

        var cards = new Dictionary<int, RadarCard>();
        await using (var radar = new SqlCommand("""
            SELECT c.CardId, p.ExternalUid, cq.Letter, cq.Position, cq.Status
            FROM dbo.Cards c
            JOIN dbo.Players p ON p.PlayerId = c.PlayerId
            JOIN dbo.CardQuestions cq ON cq.CardId = c.CardId
            WHERE c.RoundId = @roundId
              AND p.ExternalUid IS NOT NULL
              AND p.LastSeenAt IS NOT NULL
              AND p.LastSeenAt >= DATEADD(MINUTE, -5, SYSUTCDATETIME())
            ORDER BY c.CardId, cq.Position, cq.Letter;
            """, connection))
        {
            radar.Parameters.AddWithValue("@roundId", roundId);
            await using var reader = await radar.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cardId = reader.GetInt32(0);
                if (!cards.TryGetValue(cardId, out var card))
                {
                    card = new RadarCard(reader.GetString(1), new bool[36]);
                    cards[cardId] = card;
                }
                var index = (reader.GetByte(3) - 1) * 6 + LetterIndex(reader.GetString(2));
                card.Completed[index] = string.Equals(reader.GetString(4), "Correct", StringComparison.OrdinalIgnoreCase);
            }
        }

        var radarEntries = cards.Values
            .Select(card => ToRadarEntry(card, currentUid))
            .OrderByDescending(entry => entry.IsCurrentPlayer)
            .ThenBy(entry => entry.MissingBoxes)
            .ThenByDescending(entry => entry.CompletedBoxes)
            .Take(10)
            .ToArray();
        var winnerSlots = await GetWinnerSlotsAsync(roundId, connection, cancellationToken);
        return new SqlSidebarResult(radarEntries, winnerSlots, activePlayerCount);
    }

    public async Task<SqlWinnerResult?> SaveWinnerAsync(WinnerRequest request, int roundId, CancellationToken cancellationToken)
    {
        var winnerType = request.WinnerType.Trim().ToLowerInvariant();
        if (winnerType is not ("bingo" or "ultimate" or "grand")) return null;

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction(IsolationLevel.Serializable);
        await using var player = new SqlCommand("""
            SELECT TOP (1) p.PlayerId, p.Name, c.CardId
            FROM dbo.Players p
            JOIN dbo.Cards c ON c.PlayerId = p.PlayerId AND c.RoundId = @roundId
            WHERE p.ExternalUid = @uid
            ORDER BY c.CardId DESC;
            """, connection, transaction);
        player.Parameters.AddWithValue("@roundId", roundId);
        player.Parameters.AddWithValue("@uid", request.Uid);

        int playerId;
        int cardId;
        string playerName;
        await using (var reader = await player.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                transaction.Rollback();
                return null;
            }
            playerId = reader.GetInt32(0);
            playerName = reader.GetString(1);
            cardId = reader.GetInt32(2);
        }

        await using var existing = new SqlCommand("""
            SELECT TOP (1) w.WinnerId, LOWER(COALESCE(pr.PrizeType, 'bingo'))
            FROM dbo.Winners w
            LEFT JOIN dbo.Prizes pr ON pr.PrizeId = w.PrizeId
            WHERE w.RoundId = @roundId AND w.PlayerId = @playerId;
            """, connection, transaction);
        existing.Parameters.AddWithValue("@roundId", roundId);
        existing.Parameters.AddWithValue("@playerId", playerId);
        int? existingId = null;
        string? existingType = null;
        await using (var reader = await existing.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                existingId = reader.GetInt32(0);
                existingType = reader.GetString(1);
            }
        }

        if (existingId.HasValue && Rank(existingType!) >= Rank(winnerType))
        {
            transaction.Rollback();
            return new SqlWinnerResult(existingId.Value, existingType!, playerName);
        }

        if (existingId.HasValue)
        {
            await using var delete = new SqlCommand("DELETE FROM dbo.Winners WHERE WinnerId = @winnerId;", connection, transaction);
            delete.Parameters.AddWithValue("@winnerId", existingId.Value);
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var prize = new SqlCommand("""
            SELECT TOP (1) PrizeId
            FROM dbo.Prizes
            WHERE RoundId = @roundId AND IsActive = 1 AND LOWER(PrizeType) = @winnerType
            ORDER BY PrizeId;
            """, connection, transaction);
        prize.Parameters.AddWithValue("@roundId", roundId);
        prize.Parameters.AddWithValue("@winnerType", winnerType);
        var prizeIdValue = await prize.ExecuteScalarAsync(cancellationToken);

        await using var insert = new SqlCommand("""
            INSERT INTO dbo.Winners (RoundId, PlayerId, CardId, PrizeId, WinningPattern, WonAt)
            OUTPUT INSERTED.WinnerId
            VALUES (@roundId, @playerId, @cardId, @prizeId, @winningPattern, SYSUTCDATETIME());
            """, connection, transaction);
        insert.Parameters.AddWithValue("@roundId", roundId);
        insert.Parameters.AddWithValue("@playerId", playerId);
        insert.Parameters.AddWithValue("@cardId", cardId);
        insert.Parameters.AddWithValue("@prizeId", prizeIdValue is null or DBNull ? DBNull.Value : prizeIdValue);
        insert.Parameters.AddWithValue("@winningPattern", string.Join(", ", request.Patterns).Length > 100 ? string.Join(", ", request.Patterns)[..100] : string.Join(", ", request.Patterns));
        var winnerId = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return new SqlWinnerResult(winnerId, winnerType, playerName);
    }

    private async Task<IReadOnlyList<WinnerSlotResponse>> GetWinnerSlotsAsync(int roundId, SqlConnection connection, CancellationToken cancellationToken)
    {
        var candidates = new List<WinnerCandidate>();
        await using var command = new SqlCommand("""
            SELECT w.WinnerId, p.ExternalUid, p.Name, LOWER(COALESCE(pr.PrizeType, 'bingo')), COALESCE(pr.PrizeName, '')
            FROM dbo.Winners w
            JOIN dbo.Players p ON p.PlayerId = w.PlayerId
            LEFT JOIN dbo.Prizes pr ON pr.PrizeId = w.PrizeId
            WHERE w.RoundId = @roundId
            ORDER BY w.WonAt, w.WinnerId;
            """, connection);
        command.Parameters.AddWithValue("@roundId", roundId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var type = reader.GetString(3);
            if (type is "bingo" or "ultimate" or "grand")
                candidates.Add(new WinnerCandidate(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), type, reader.GetString(4)));
        }

        var awarded = new HashSet<string>(StringComparer.Ordinal);
        var slots = new List<WinnerSlotResponse>();
        slots.AddRange(CreateSlots(SelectCandidates(candidates, "grand", awarded, 1), 1, "grand", "RM100 Voucher"));
        slots.AddRange(CreateSlots(SelectCandidates(candidates, "ultimate", awarded, 5), 5, "ultimate", "Ultimate Winner"));
        slots.AddRange(CreateSlots(SelectCandidates(candidates, "bingo", awarded, 10), 10, "bingo", "RM10 prize each"));
        return slots;
    }

    private static IEnumerable<WinnerSlotResponse> CreateSlots(IReadOnlyList<WinnerCandidate> winners, int count, string type, string defaultPrize)
    {
        for (var index = 0; index < count; index++)
        {
            var winner = winners.ElementAtOrDefault(index);
            yield return new WinnerSlotResponse(index + 1, winner?.PlayerName, type, winner?.PrizeName ?? defaultPrize);
        }
    }

    private static IReadOnlyList<WinnerCandidate> SelectCandidates(IEnumerable<WinnerCandidate> candidates, string type, ISet<string> awarded, int limit)
    {
        var selected = candidates.Where(candidate => candidate.WinnerType == type)
            .Where(candidate => awarded.Add(candidate.Uid))
            .Take(limit)
            .ToArray();
        return selected;
    }

    private static RadarEntry ToRadarEntry(RadarCard card, string currentUid)
    {
        var missing = DistanceToPattern(card.Completed);
        var isCurrent = string.Equals(card.Uid, currentUid, StringComparison.Ordinal);
        var label = missing == 0 ? "ETIQAN Winner" : missing == 1 ? "Needs 1 answer" : $"{missing} boxes away";
        return new RadarEntry(MaskParticipant(card.Uid) + (isCurrent ? " (You)" : string.Empty), isCurrent, card.Completed.Count(value => value), label, missing);
    }

    private static string MaskParticipant(string uid)
    {
        var suffix = uid.Length > 3 ? uid[^3..].ToUpperInvariant() : uid.ToUpperInvariant();
        return $"ETQ-**{suffix}";
    }

    private static int DistanceToPattern(IReadOnlyList<bool> completed)
    {
        var lines = new List<int[]>();
        lines.AddRange(Enumerable.Range(0, 6).Select(row => Enumerable.Range(0, 6).Select(column => row * 6 + column).ToArray()));
        lines.AddRange(Enumerable.Range(0, 6).Select(column => Enumerable.Range(0, 6).Select(row => row * 6 + column).ToArray()));
        lines.Add(Enumerable.Range(0, 6).Select(index => index * 6 + index).ToArray());
        lines.Add(Enumerable.Range(0, 6).Select(index => index * 6 + (5 - index)).ToArray());
        return lines.Min(line => line.Count(index => !completed[index]));
    }

    private static int LetterIndex(string letter) => Array.IndexOf(Letters, letter.Trim().ToUpperInvariant()) switch
    {
        >= 0 and var index => index,
        _ => 0
    };

    private static int Rank(string winnerType) => winnerType switch
    {
        "bingo" => 1,
        "ultimate" => 2,
        "grand" => 3,
        _ => 0
    };

    private static string OptionText(string option, string a, string b, string c, string d) => option.ToUpperInvariant() switch
    {
        "A" => a,
        "B" => b,
        "C" => c,
        "D" => d,
        _ => string.Empty
    };

    private static CardCellRequest ReadCardCell(SqlDataReader reader)
    {
        var questionId = reader.GetInt32(5);
        var letter = reader.GetString(1).Trim();
        var position = reader.GetByte(2);
        var row = position - 1;
        var column = LetterIndex(letter);
        var optionA = reader.GetString(7);
        var optionB = reader.GetString(8);
        var optionC = reader.GetString(9);
        var optionD = reader.IsDBNull(10) ? string.Empty : reader.GetString(10);
        var correctOption = reader.GetString(11).Trim();
        var question = new QuestionResponse(
            questionId.ToString(), letter, row, row * 6 + column, row,
            reader.GetString(6), reader.GetString(4), optionA, optionB, optionC, optionD,
            correctOption, OptionText(correctOption, optionA, optionB, optionC, optionD));
        var status = reader.GetString(3);
        var isCorrect = string.Equals(status, "Correct", StringComparison.OrdinalIgnoreCase);
        var isWrong = string.Equals(status, "Eliminated", StringComparison.OrdinalIgnoreCase);
        return new CardCellRequest(row * 6 + column, row, column, question, [questionId.ToString()], isCorrect, isWrong, isWrong);
    }

    private async Task<SqlConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private const string CardQuery = """
        SELECT cq.CardQuestionId, cq.Letter, cq.Position, cq.Status, q.Category,
               q.QuestionId, q.QuestionText, q.OptionA, q.OptionB, q.OptionC, q.OptionD, q.CorrectOption
        FROM dbo.Cards c
        JOIN dbo.Players p ON p.PlayerId = c.PlayerId
        JOIN dbo.CardQuestions cq ON cq.CardId = c.CardId
        JOIN dbo.Questions q ON q.QuestionId = cq.QuestionId
        WHERE p.ExternalUid = @uid
          AND c.RoundId = @roundId
          AND c.CardId = (
              SELECT TOP (1) c2.CardId
              FROM dbo.Cards c2
              JOIN dbo.Players p2 ON p2.PlayerId = c2.PlayerId
              WHERE p2.ExternalUid = @uid AND c2.RoundId = @roundId
              ORDER BY c2.CardId DESC
          )
        ORDER BY cq.Position, CASE cq.Letter WHEN 'E' THEN 0 WHEN 'T' THEN 1 WHEN 'I' THEN 2 WHEN 'Q' THEN 3 WHEN 'A' THEN 4 ELSE 5 END;
        """;

    private sealed record RadarCard(string Uid, bool[] Completed);
    private sealed record WinnerCandidate(int Id, string Uid, string PlayerName, string WinnerType, string PrizeName);
}
