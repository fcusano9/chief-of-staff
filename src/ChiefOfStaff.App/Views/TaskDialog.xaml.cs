using System.Collections.ObjectModel;
using ChiefOfStaff.App.Helpers;
using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace ChiefOfStaff.App.Views;

/// <summary>Pop-over dialog for creating or editing a task. Opens above whatever screen is showing.</summary>
public sealed partial class TaskDialog : ContentDialog
{
    private static readonly WorkItemStatus[] StatusOrder =
        [WorkItemStatus.Open, WorkItemStatus.InProgress, WorkItemStatus.WaitingOn, WorkItemStatus.Done];

    private static readonly Project NoProject = new() { Id = 0, Name = "No project", ColorHex = ProjectColors.NoProject };
    private static readonly Person Nobody = new() { Id = 0, Name = "Nobody" };

    private readonly WorkItem _item;
    private readonly ObservableCollection<SubtaskEdit> _subtasks = [];
    private bool _deleteArmed;

    /// <summary>True if anything was saved or deleted.</summary>
    public bool Changed { get; private set; }

    private TaskDialog(WorkItem item, List<Project> projects, List<Person> people, ContextBrief brief, ContextBrief? projectBrief, ContextBrief? personBrief)
    {
        InitializeComponent();
        _item = item;

        ProjectBox.ItemsSource = new List<Project> { NoProject }.Concat(projects).ToList();
        ProjectBox.SelectedItem = projects.FirstOrDefault(p => p.Id == item.ProjectId) ?? NoProject;
        RequesterBox.ItemsSource = new List<Person> { Nobody }.Concat(people).ToList();
        RequesterBox.SelectedItem = people.FirstOrDefault(p => p.Id == item.RequesterId) ?? Nobody;

        TitleBox.Text = item.Title;
        StatusBox.SelectedIndex = Math.Max(0, Array.IndexOf(StatusOrder, item.Status));
        DueBox.Date = item.DueDate is { } d ? new DateTimeOffset(d) : null;
        WaitingOnBox.Text = item.WaitingOn ?? "";
        NotesBox.Text = item.Notes ?? "";

        var (bg, fg) = ColorHelper.ScoreBrushes(item.EffectivePriority);
        ScoreBadge.Background = bg;
        ScoreText.Foreground = fg;
        ScoreText.Text = item.Id == 0 ? "New" : item.PriorityScore.ToString();
        RationaleText.Text = item.Id == 0 ? "Priority is calculated when you save" : item.PriorityRationale ?? "";
        OverrideCheck.IsChecked = item.PriorityOverride is not null;
        OverrideBox.Value = item.PriorityOverride ?? item.PriorityScore;

        foreach (var s in item.Subtasks.OrderBy(s => s.SortOrder))
            _subtasks.Add(new SubtaskEdit { Id = s.Id, Title = s.Title, IsDone = s.IsDone });
        SubtaskList.ItemsSource = _subtasks;

        BriefSummaryBox.Text = brief.Summary;
        BriefInstructionsBox.Text = brief.StandingInstructions;

        if (item.Id != 0)
        {
            DeleteButton.Visibility = Visibility.Visible;
            if (item.Status != WorkItemStatus.Done) SecondaryButtonText = "Mark done";
        }

        AiKnowsList.ItemsSource = DescribeContext(item, projectBrief, personBrief, brief);
        UpdateStripe();
        UpdateSaveEnabled();
    }

    /// <summary>Opens the dialog for an existing task (id) or a new one. Returns true if data changed.</summary>
    public static async Task<bool> ShowForAsync(XamlRoot root, int? id = null, int? defaultProjectId = null)
    {
        var tasks = App.Get<WorkItemService>();
        var briefs = App.Get<BriefService>();
        var item = id is { } existing
            ? await tasks.GetAsync(existing) ?? new WorkItem()
            : new WorkItem { ProjectId = defaultProjectId };
        var projects = await App.Get<ProjectService>().GetActiveAsync();
        var people = await App.Get<PersonService>().GetAllAsync();
        var brief = item.Id == 0 ? new ContextBrief() : await briefs.GetAsync(BriefScope.WorkItem, item.Id);
        var projectBrief = item.ProjectId is { } pid ? await briefs.GetAsync(BriefScope.Project, pid) : null;
        var personBrief = item.RequesterId is { } rid ? await briefs.GetAsync(BriefScope.Person, rid) : null;

        var dialog = new TaskDialog(item, projects, people, brief, projectBrief, personBrief) { XamlRoot = root };
        await dialog.ShowAsync();
        return dialog.Changed;
    }

    /// <summary>
    /// Lists what context would be handed to the AI for this task. The AI features arrive in milestone 2;
    /// this already reflects the stored briefs and history so gaps are visible.
    /// </summary>
    private static List<string> DescribeContext(WorkItem item, ContextBrief? projectBrief, ContextBrief? personBrief, ContextBrief taskBrief)
    {
        static bool Has(ContextBrief? b) => b is not null && (b.Summary.Length > 0 || b.StandingInstructions.Length > 0);
        var lines = new List<string>();
        if (item.Project is not null)
            lines.Add(Has(projectBrief) ? $"✓ {item.Project.Name} project brief and standing instructions" : $"○ {item.Project.Name} project brief is empty");
        lines.Add(Has(taskBrief) ? "✓ Task context brief" : "○ Task context brief is empty");
        if (item.Requester is not null)
            lines.Add(Has(personBrief) ? $"✓ Person brief: {item.Requester.Name}" : $"○ Person brief for {item.Requester.Name} is empty");
        lines.Add($"✓ Notes, {item.Subtasks.Count} subtask{(item.Subtasks.Count == 1 ? "" : "s")}, {item.StatusUpdates.Count} status update{(item.StatusUpdates.Count == 1 ? "" : "s")}");
        lines.Add("○ Linked emails and transcripts (after Outlook and import are connected)");
        return lines;
    }

    private void UpdateStripe()
    {
        var project = ProjectBox.SelectedItem as Project;
        Stripe.Background = ColorHelper.Brush(project is null || project.Id == 0 ? ProjectColors.NoProject : project.ColorHex);
    }

    private void UpdateSaveEnabled() => IsPrimaryButtonEnabled = !string.IsNullOrWhiteSpace(TitleBox.Text);

    private void TitleBox_TextChanged(object sender, TextChangedEventArgs e) => UpdateSaveEnabled();
    private void ProjectBox_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateStripe();

    private void StatusBox_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        WaitingOnBox.Visibility = SelectedStatus == WorkItemStatus.WaitingOn ? Visibility.Visible : Visibility.Collapsed;

    private void OverrideCheck_Changed(object sender, RoutedEventArgs e) => OverrideBox.IsEnabled = OverrideCheck.IsChecked == true;

    private WorkItemStatus SelectedStatus => StatusOrder[Math.Max(0, StatusBox.SelectedIndex)];

    private void AddSubtask_Click(object sender, RoutedEventArgs e) => AddSubtask();

    private void NewSubtaskBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != Windows.System.VirtualKey.Enter) return;
        AddSubtask();
        e.Handled = true;
    }

    private void AddSubtask()
    {
        if (string.IsNullOrWhiteSpace(NewSubtaskBox.Text)) return;
        _subtasks.Add(new SubtaskEdit { Title = NewSubtaskBox.Text.Trim() });
        NewSubtaskBox.Text = "";
    }

    private void RemoveSubtask_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is SubtaskEdit s) _subtasks.Remove(s);
    }

    private async void OnSave(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        await SaveWithStatusAsync(args, SelectedStatus);

    private async void OnMarkDone(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        await SaveWithStatusAsync(args, WorkItemStatus.Done);

    private async Task SaveWithStatusAsync(ContentDialogButtonClickEventArgs args, WorkItemStatus status)
    {
        var deferral = args.GetDeferral();
        try
        {
            _item.Title = TitleBox.Text;
            _item.Status = status;
            _item.ProjectId = ProjectBox.SelectedItem is Project { Id: > 0 } p ? p.Id : null;
            _item.RequesterId = RequesterBox.SelectedItem is Person { Id: > 0 } r ? r.Id : null;
            _item.DueDate = DueBox.Date?.Date;
            _item.WaitingOn = string.IsNullOrWhiteSpace(WaitingOnBox.Text) ? null : WaitingOnBox.Text.Trim();
            _item.Notes = string.IsNullOrWhiteSpace(NotesBox.Text) ? null : NotesBox.Text;
            _item.PriorityOverride = OverrideCheck.IsChecked == true && !double.IsNaN(OverrideBox.Value)
                ? (int)Math.Clamp(OverrideBox.Value, 0, 100)
                : null;
            _item.Subtasks = _subtasks.Where(s => !string.IsNullOrWhiteSpace(s.Title))
                .Select(s => new Subtask { Id = s.Id, Title = s.Title, IsDone = s.IsDone }).ToList();

            var saved = await App.Get<WorkItemService>().SaveAsync(_item);
            await App.Get<BriefService>().SaveAsync(new ContextBrief
            {
                Scope = BriefScope.WorkItem,
                OwnerId = saved.Id,
                Summary = BriefSummaryBox.Text,
                StandingInstructions = BriefInstructionsBox.Text,
            });
            Changed = true;
        }
        catch (Exception ex)
        {
            args.Cancel = true;
            ErrorText.Text = "Couldn't save this task. " + ex.Message;
            ErrorText.Visibility = Visibility.Visible;
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (!_deleteArmed)
        {
            _deleteArmed = true;
            DeleteButton.Content = "Click again to permanently delete this task";
            return;
        }
        await App.Get<WorkItemService>().DeleteAsync(_item.Id);
        Changed = true;
        Hide();
    }
}
