namespace ChiefOfStaff.Core.Models;

public enum WorkItemStatus
{
    Proposed,
    Open,
    InProgress,
    WaitingOn,
    Done,
    Dismissed,
}

public enum ProjectStatus
{
    Active,
    OnHold,
    Completed,
    Archived,
}

public enum BriefScope
{
    Project,
    WorkItem,
    Person,
}

public enum SourceKind
{
    Email,
    TeamsChat,
    MeetingTranscript,
    CopilotSummary,
    Note,
}
