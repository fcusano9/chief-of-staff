using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

/// <summary>
/// Placeholder for screens from the approved mockups whose features arrive in later milestones.
/// Navigate with the nav tag as the parameter. (Frame.Navigate needs a XAML page; code-only pages crash.)
/// </summary>
public sealed partial class ComingSoonPage : Page
{
    private static readonly Dictionary<string, (string Title, string Description, string Milestone)> Screens = new()
    {
        ["review"] = ("Review queue",
            "AI suggestions from your emails, chats, transcripts, and Copilot summaries land here: new tasks, status updates, context-brief updates, and items that look done. Nothing changes until you accept it.",
            "Milestone 2: AI core (Claude provider, paste/import, extraction, review queue)."),
        ["prep"] = ("Meeting prep",
            "Before each meeting: open items with the attendees, recent decisions, and suggested talking points, pulled from your Outlook calendar and the knowledge archive.",
            "Milestone 5: knowledge archive and meeting prep (needs Outlook calendar from milestone 4)."),
        ["weekly"] = ("Weekly review",
            "What you completed, what's new, what's slipping, and a status-report draft you can copy or save to Outlook drafts.",
            "Milestone 3: prioritization and briefings."),
        ["archive"] = ("Ask your archive",
            "Ask about anything you've worked on, even years ago. Answers cite the dated emails, transcripts, and tasks they came from.",
            "Milestone 5: knowledge archive (full-text and semantic search, archive chat)."),
        ["import"] = ("Import",
            "Scan Outlook, paste a Copilot weekly summary, Teams chat, or transcript, or drop transcript files. The AI turns them into suggestions for your review queue.",
            "Milestone 2 adds paste and file import; milestone 4 adds Outlook scanning."),
    };

    public static bool Handles(string tag) => Screens.ContainsKey(tag);

    public ComingSoonPage() => InitializeComponent();

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        if (e.Parameter is not string tag || !Screens.TryGetValue(tag, out var screen)) return;
        TitleText.Text = screen.Title;
        DescriptionText.Text = screen.Description;
        MilestoneBar.Message = screen.Milestone;
    }
}
