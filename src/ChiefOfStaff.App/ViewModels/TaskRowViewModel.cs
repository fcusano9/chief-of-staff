using ChiefOfStaff.App.Helpers;
using ChiefOfStaff.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace ChiefOfStaff.App.ViewModels;

/// <summary>Display wrapper for a task row: project-colored stripe, priority badge, optional project chip.</summary>
public class TaskRowViewModel(WorkItem item)
{
    public WorkItem Item { get; } = item;
    public int Id => Item.Id;
    public string Title => Item.Title;
    public int Score => Item.EffectivePriority;
    public string ScoreText => Score.ToString();
    public Brush ScoreBackground => ColorHelper.ScoreBrushes(Score).Background;
    public Brush ScoreForeground => ColorHelper.ScoreBrushes(Score).Foreground;

    public Brush StripeBrush => ColorHelper.Brush(Item.Project?.ColorHex ?? ProjectColors.NoProject);

    /// <summary>Tasks with no project show no label.</summary>
    public Visibility ProjectVisibility => Item.Project is null ? Visibility.Collapsed : Visibility.Visible;
    public string ProjectName => Item.Project?.Name ?? "";
    public Brush ProjectChipBackground => ColorHelper.Tint(Item.Project?.ColorHex);

    public string DueText => FormatDue(Item.DueDate);

    public string Subtitle
    {
        get
        {
            var parts = new List<string>();
            if (Item.DueDate is not null) parts.Add(DueText);
            if (Item.Requester is not null) parts.Add(Item.Requester.Name);
            if (Item.Status == WorkItemStatus.WaitingOn && !string.IsNullOrWhiteSpace(Item.WaitingOn)) parts.Add("Waiting on " + Item.WaitingOn);
            return string.Join(" · ", parts);
        }
    }

    public string Rationale => Item.PriorityOverride is not null ? "Priority set by you" : Item.PriorityRationale ?? "";

    public string WaitingDaysText
    {
        get
        {
            var since = (Item.WaitingSince ?? Item.LastActivityAt).ToLocalTime();
            var days = Math.Max(0, (int)(DateTime.Now - since).TotalDays);
            return days == 1 ? "1 day" : $"{days} days";
        }
    }

    public Brush WaitingBackground
    {
        get
        {
            var days = (DateTime.Now - (Item.WaitingSince ?? Item.LastActivityAt).ToLocalTime()).TotalDays;
            return ColorHelper.ScoreBrushes(days >= 7 ? 90 : days >= 3 ? 70 : 0).Background;
        }
    }

    public static string FormatDue(DateTime? due)
    {
        if (due is not { } d) return "";
        var days = (d.Date - DateTime.Today).Days;
        return days switch
        {
            < 0 => $"Overdue {-days}d",
            0 => "Today",
            1 => "Tomorrow",
            < 7 => d.ToString("ddd"),
            _ => d.ToString("MMM d"),
        };
    }
}
