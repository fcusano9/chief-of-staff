namespace ChiefOfStaff.Core.Models;

public class WorkItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Notes { get; set; }
    public WorkItemStatus Status { get; set; } = WorkItemStatus.Open;
    public DateTime? DueDate { get; set; }

    /// <summary>Optional: one-off tasks have no project.</summary>
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }

    public int? RequesterId { get; set; }
    public Person? Requester { get; set; }

    public List<Subtask> Subtasks { get; set; } = [];
    public List<StatusUpdate> StatusUpdates { get; set; } = [];

    /// <summary>Computed 0-100 score; see PriorityEngine.</summary>
    public int PriorityScore { get; set; }
    public string? PriorityRationale { get; set; }

    /// <summary>When set, replaces the computed score.</summary>
    public int? PriorityOverride { get; set; }

    public int EffectivePriority => PriorityOverride ?? PriorityScore;

    public int FollowUpCount { get; set; }

    /// <summary>Who or what this item is waiting on (when Status is WaitingOn).</summary>
    public string? WaitingOn { get; set; }
    public DateTime? WaitingSince { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastActivityAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    public bool IsActive => Status is WorkItemStatus.Open or WorkItemStatus.InProgress or WorkItemStatus.WaitingOn;
}

public class Subtask
{
    public int Id { get; set; }
    public int WorkItemId { get; set; }
    public string Title { get; set; } = "";
    public bool IsDone { get; set; }
    public int SortOrder { get; set; }
}

public class StatusUpdate
{
    public int Id { get; set; }
    public int WorkItemId { get; set; }
    public string Text { get; set; } = "";
    public bool IsAiGenerated { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
