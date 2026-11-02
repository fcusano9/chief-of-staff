using ChiefOfStaff.App.Helpers;
using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class ProjectsPage : Page
{
    public record ProjectCard(Project Project, int OpenCount)
    {
        public string Name => Project.Name;
        public string OpenText => $"{OpenCount} open · {Project.Status}";
        public Brush ColorBrush => ColorHelper.Brush(Project.ColorHex);
    }

    public record ColorSwatch(string Hex, bool Selected)
    {
        public Brush Brush => ColorHelper.Brush(Hex);
        public Thickness Border => new(Selected ? 3 : 0);
    }

    private static readonly ProjectStatus[] StatusOrder =
        [ProjectStatus.Active, ProjectStatus.OnHold, ProjectStatus.Completed, ProjectStatus.Archived];

    private Project? _editing;
    private string _color = ProjectColors.Default;
    private bool _deleteArmed;

    public ProjectsPage() => InitializeComponent();

    protected override async void OnNavigatedTo(NavigationEventArgs e) => await LoadAsync();

    private async Task LoadAsync(int? selectId = null)
    {
        var cards = (await App.Get<ProjectService>().GetSummariesAsync()).Select(s => new ProjectCard(s.Project, s.OpenCount)).ToList();
        ProjectGrid.ItemsSource = cards;
        EmptyText.Visibility = cards.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        var id = selectId ?? _editing?.Id;
        var selected = cards.FirstOrDefault(c => c.Project.Id == id) ?? (_editing is null ? cards.FirstOrDefault() : null);
        if (selected is not null) ProjectGrid.SelectedItem = selected;
        else if (_editing is { Id: 0 }) await ShowDetailAsync(_editing);
        else DetailCard.Visibility = Visibility.Collapsed;
    }

    private async void ProjectGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ProjectGrid.SelectedItem is ProjectCard card) await ShowDetailAsync(card.Project);
    }

    private async Task ShowDetailAsync(Project project)
    {
        _editing = project;
        _deleteArmed = false;
        DeleteButton.Content = "Delete project";
        DeleteButton.Visibility = project.Id == 0 ? Visibility.Collapsed : Visibility.Visible;
        NameBox.Text = project.Name;
        StatusBox.SelectedIndex = Array.IndexOf(StatusOrder, project.Status);
        SetColor(project.ColorHex);
        StatusText.Text = "";

        var brief = project.Id == 0 ? new ContextBrief() : await App.Get<BriefService>().GetAsync(BriefScope.Project, project.Id);
        BriefSummaryBox.Text = brief.Summary;
        BriefInstructionsBox.Text = brief.StandingInstructions;
        BriefUpdatedText.Text = brief.Id == 0 ? "" : $"Last updated {brief.UpdatedAt.ToLocalTime():MMM d, yyyy h:mm tt}";

        ProjectTasks.ItemsSource = project.Id == 0
            ? []
            : (await App.Get<WorkItemService>().GetActiveAsync(project.Id)).Select(w => new TaskRowViewModel(w)).ToList();
        DetailCard.Visibility = Visibility.Visible;
    }

    private void SetColor(string hex)
    {
        _color = hex;
        DetailStripe.Background = ColorHelper.Brush(hex);
        ColorPicker.ItemsSource = ProjectColors.Palette.Select(c => new ColorSwatch(c, c.Equals(hex, StringComparison.OrdinalIgnoreCase))).ToList();
    }

    private void Color_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.Tag is string hex) SetColor(hex);
    }

    private async void NewProject_Click(object sender, RoutedEventArgs e)
    {
        ProjectGrid.SelectedItem = null;
        var used = ((IEnumerable<ProjectCard>?)ProjectGrid.ItemsSource ?? []).Select(c => c.Project.ColorHex).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var color = ProjectColors.Palette.FirstOrDefault(c => !used.Contains(c)) ?? ProjectColors.Default;
        await ShowDetailAsync(new Project { ColorHex = color });
        NameBox.Focus(FocusState.Programmatic);
    }

    private async void Save_Click(object sender, RoutedEventArgs e) => await SaveAsync();

    private async Task<bool> SaveAsync()
    {
        if (_editing is null) return false;
        if (string.IsNullOrWhiteSpace(NameBox.Text))
        {
            StatusText.Text = "Enter a project name first.";
            return false;
        }
        _editing.Name = NameBox.Text;
        _editing.ColorHex = _color;
        _editing.Status = StatusOrder[Math.Max(0, StatusBox.SelectedIndex)];
        var saved = await App.Get<ProjectService>().SaveAsync(_editing);
        await App.Get<BriefService>().SaveAsync(new ContextBrief
        {
            Scope = BriefScope.Project,
            OwnerId = saved.Id,
            Summary = BriefSummaryBox.Text,
            StandingInstructions = BriefInstructionsBox.Text,
        });
        _editing = saved;
        await LoadAsync(saved.Id);
        StatusText.Text = "Saved";
        return true;
    }

    private async void NewTask_Click(object sender, RoutedEventArgs e)
    {
        if (_editing is null) return;
        if (_editing.Id == 0 && !await SaveAsync()) return;
        if (await TaskDialog.ShowForAsync(XamlRoot, null, _editing.Id)) await LoadAsync(_editing.Id);
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_editing is not { Id: > 0 }) return;
        if (!_deleteArmed)
        {
            _deleteArmed = true;
            DeleteButton.Content = "Click again to delete (tasks are kept, with no project)";
            return;
        }
        await App.Get<ProjectService>().DeleteAsync(_editing.Id);
        _editing = null;
        await LoadAsync();
    }

    private async void Task_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is TaskRowViewModel row && await TaskDialog.ShowForAsync(XamlRoot, row.Id)) await LoadAsync(_editing?.Id);
    }
}
