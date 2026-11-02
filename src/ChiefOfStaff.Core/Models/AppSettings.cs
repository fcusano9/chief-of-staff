namespace ChiefOfStaff.Core.Models;

public class AppSettings
{
    public PriorityWeights PriorityWeights { get; set; } = new();
    public TimeSpan DailyBriefingTime { get; set; } = new(7, 30, 0);
    public bool StartWithWindows { get; set; }

    /// <summary>Null means the default OneDrive backup folder.</summary>
    public string? BackupFolder { get; set; }
    public int BackupsToKeep { get; set; } = 30;
    public DateTime? LastBackupAt { get; set; }
}

/// <summary>Relative weights (0-10) for the deterministic priority score.</summary>
public class PriorityWeights
{
    public int DueDate { get; set; } = 8;
    public int Requester { get; set; } = 7;
    public int Staleness { get; set; } = 5;
}
