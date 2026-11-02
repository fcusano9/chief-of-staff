namespace ChiefOfStaff.Core.Models;

public class Project
{
    public int Id { get; set; }
    public string Name { get; set; } = "";

    /// <summary>Hex color like "#7F77DD"; tasks in this project are themed with it.</summary>
    public string ColorHex { get; set; } = ProjectColors.Default;

    public ProjectStatus Status { get; set; } = ProjectStatus.Active;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<WorkItem> WorkItems { get; set; } = [];
}

public static class ProjectColors
{
    public const string Default = "#7F77DD";

    /// <summary>Palette offered when picking a project color.</summary>
    public static readonly IReadOnlyList<string> Palette =
    [
        "#7F77DD", // purple
        "#1D9E75", // teal
        "#D85A30", // coral
        "#D4537E", // pink
        "#378ADD", // blue
        "#639922", // green
        "#BA7517", // amber
        "#E24B4A", // red
    ];

    /// <summary>Stripe color for tasks that don't belong to a project.</summary>
    public const string NoProject = "#B4B2A9";
}
