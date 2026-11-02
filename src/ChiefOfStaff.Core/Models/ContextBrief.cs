namespace ChiefOfStaff.Core.Models;

/// <summary>
/// Living context for a project, task, or person so the AI never needs things re-explained.
/// The AI proposes updates (via the review queue); Frank can edit it directly.
/// </summary>
public class ContextBrief
{
    public int Id { get; set; }
    public BriefScope Scope { get; set; }
    public int OwnerId { get; set; }

    /// <summary>Goals, background, key decisions with dates, stakeholders, timeline, open questions.</summary>
    public string Summary { get; set; } = "";

    /// <summary>Instructions written by the user, e.g. "VP prefers one-page summaries".</summary>
    public string StandingInstructions { get; set; } = "";

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
