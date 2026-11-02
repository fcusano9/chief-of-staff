using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class TodayPage : Page
{
    private const int FocusCount = 7;

    public TodayPage() => InitializeComponent();

    protected override async void OnNavigatedTo(NavigationEventArgs e) => await LoadAsync();

    private async Task LoadAsync()
    {
        var hour = DateTime.Now.Hour;
        Greeting.Text = (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening") + ", Frank";
        SubGreeting.Text = DateTime.Now.ToString("dddd, MMMM d");

        var tasks = App.Get<WorkItemService>();
        var summary = await tasks.GetTodaySummaryAsync();
        UrgentCount.Text = summary.Urgent.ToString();
        OpenCount.Text = summary.Open.ToString();
        WaitingCount.Text = summary.WaitingOn.ToString();
        OverdueCount.Text = summary.Overdue.ToString();

        var top = (await tasks.GetActiveAsync()).Take(FocusCount).Select(w => new TaskRowViewModel(w)).ToList();
        FocusList.ItemsSource = top;
        EmptyText.Visibility = top.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        await App.Get<WorkItemService>().RecomputeAllAsync();
        await LoadAsync();
    }

    private async void NewTask_Click(object sender, RoutedEventArgs e)
    {
        if (await TaskDialog.ShowForAsync(XamlRoot)) await LoadAsync();
    }

    private async void Task_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is TaskRowViewModel row && await TaskDialog.ShowForAsync(XamlRoot, row.Id)) await LoadAsync();
    }
}
