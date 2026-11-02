using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class TasksPage : Page
{
    private record Filter(string Label, int? ProjectId, bool NoProjectOnly);

    private bool _loadingFilters;

    public TasksPage() => InitializeComponent();

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        _loadingFilters = true;
        var filters = new List<Filter> { new("All tasks", null, false) };
        filters.AddRange((await App.Get<ProjectService>().GetActiveAsync()).Select(p => new Filter(p.Name, p.Id, false)));
        filters.Add(new Filter("No project", null, true));
        FilterBox.ItemsSource = filters;
        FilterBox.SelectedIndex = 0;
        _loadingFilters = false;
        await LoadAsync();
    }

    private async Task LoadAsync()
    {
        var filter = FilterBox.SelectedItem as Filter;
        var items = await App.Get<WorkItemService>().GetActiveAsync(filter?.ProjectId, filter?.NoProjectOnly ?? false, SearchBox.Text);
        TaskList.ItemsSource = items.Select(w => new TaskRowViewModel(w)).ToList();
        EmptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => await LoadAsync();

    private async void FilterBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_loadingFilters) await LoadAsync();
    }

    private async void NewTask_Click(object sender, RoutedEventArgs e)
    {
        var projectId = (FilterBox.SelectedItem as Filter)?.ProjectId;
        if (await TaskDialog.ShowForAsync(XamlRoot, null, projectId)) await LoadAsync();
    }

    private async void Task_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is TaskRowViewModel row && await TaskDialog.ShowForAsync(XamlRoot, row.Id)) await LoadAsync();
    }
}
