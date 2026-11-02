namespace ChiefOfStaff.Core.Models;

/// <summary>Raw input (email, chat, transcript, summary). Kept permanently for the knowledge archive.</summary>
public class SourceItem
{
    public int Id { get; set; }
    public SourceKind Kind { get; set; }
    public string Title { get; set; } = "";
    public string? From { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public string Content { get; set; } = "";

    /// <summary>SHA-256 of normalized content, used to skip duplicates.</summary>
    public string ContentHash { get; set; } = "";

    /// <summary>ID in the originating system (e.g. Outlook EntryID).</summary>
    public string? ExternalId { get; set; }

    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
}
