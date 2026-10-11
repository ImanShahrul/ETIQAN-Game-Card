USE [EtiqanGame];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Identify a participant without an external authentication provider. */
IF COL_LENGTH('dbo.Players', 'ExternalUid') IS NULL
BEGIN
    ALTER TABLE dbo.Players ADD ExternalUid nvarchar(100) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_Players_ExternalUid'
      AND object_id = OBJECT_ID('dbo.Players')
)
BEGIN
    CREATE UNIQUE INDEX UX_Players_ExternalUid
        ON dbo.Players(ExternalUid)
        WHERE ExternalUid IS NOT NULL;
END;
GO

/* A participant can receive only one prize in a round. */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_Winners_Round_Player'
      AND object_id = OBJECT_ID('dbo.Winners')
)
BEGIN
    CREATE UNIQUE INDEX UX_Winners_Round_Player
        ON dbo.Winners(RoundId, PlayerId);
END;
GO

/* Create a development round only when no active round exists. */
IF NOT EXISTS (SELECT 1 FROM dbo.GameRounds WHERE Status = 'Active')
BEGIN
    INSERT INTO dbo.GameRounds (RoundName, StartDate, EndDate, Status, CreatedAt)
    VALUES ('Round 12', DATEADD(DAY, -1, SYSUTCDATETIME()), DATEADD(DAY, 30, SYSUTCDATETIME()), 'Active', SYSUTCDATETIME());
END;
GO

DECLARE @RoundId int = (SELECT TOP (1) RoundId FROM dbo.GameRounds WHERE Status = 'Active' ORDER BY RoundId DESC);

IF @RoundId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Prizes WHERE RoundId = @RoundId)
BEGIN
    INSERT INTO dbo.Prizes (RoundId, PrizeName, PrizeType, Quantity, IsActive)
    VALUES
        (@RoundId, 'RM10 prize each', 'bingo', 10, 1),
        (@RoundId, 'Ultimate Winner', 'ultimate', 5, 1),
        (@RoundId, 'RM100 Voucher', 'grand', 1, 1);
END;
GO
