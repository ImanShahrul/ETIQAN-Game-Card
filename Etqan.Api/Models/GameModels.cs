using System.Text.Json.Serialization;

namespace Etqan.Api.Models;

public sealed record PlayerRegistrationRequest(string Name, string Uid);
public sealed record PlayerRegistrationResponse(string Id, string Uid, string Name);

public sealed record QuestionResponse(
    string Id,
    string Letter,
    int? Row,
    int? Index,
    int? Order,
    string Question,
    string Category,
    string OptionA,
    string OptionB,
    string OptionC,
    string OptionD,
    string CorrectOption,
    string CorrectAnswer);

public sealed record CardCellRequest(
    int Index,
    int Row,
    int Column,
    QuestionResponse Question,
    IReadOnlyList<string> UsedQuestionIds,
    bool IsTicked,
    bool IsWrong,
    bool NeedsRetry);

public sealed record SaveCardRequest(string Uid, IReadOnlyList<CardCellRequest> Cells);
public sealed record GenerateCardRequest(string Uid);
public sealed record AnswerRequest(string Uid, int CellIndex, string Option);
public sealed record RetryRequest(string Uid, int CellIndex);

public sealed record AnswerResponse(bool Correct, int CellIndex, IReadOnlyList<CardCellRequest> Cells);
public sealed record WinnerRequest(
    string Uid,
    string PlayerName,
    string WinnerType,
    IReadOnlyList<string> Patterns,
    int BingoCount,
    IReadOnlyList<bool> CompletedCells);

public sealed record WinnerResponse(string Id, string WinnerType, string PlayerName);
public sealed record RadarEntry(string Id, bool IsCurrentPlayer, int CompletedBoxes, string DistanceLabel, int MissingBoxes);
public sealed record WinnerSlotResponse(int Slot, string? PlayerName, string WinnerType, string Prize);
public sealed record GameSidebarResponse(
    IReadOnlyList<RadarEntry> Radar,
    IReadOnlyList<WinnerSlotResponse> WinnerSlots,
    int ActivePlayerCount);
